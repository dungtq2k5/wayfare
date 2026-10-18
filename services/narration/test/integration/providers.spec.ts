// Provider fallback and final failures (conventions §11.5, rdm-spec N-2).
import {
  NARRATION_LOCALIZATION_FAILED,
  PROVIDER_FAILURE_THRESHOLD,
  PROVIDER_OUTAGE_RETRY_WINDOW_MS,
  SynthesisFailureReason,
  SynthesisJobStatus,
  SynthesisTaskStatus,
} from '@wayfare/contracts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ProviderChain } from '../../src/providers/provider-chain';
import { FakeSpeechProvider } from '../../src/providers/speech/fake.speech-provider';
import type { SpeechProvider } from '../../src/providers/speech/speech-provider';
import { FakeTranslationProvider } from '../../src/providers/translation/fake.translation-provider';
import { configuredChains } from '../../src/providers/configured-providers';
import { outboxPayloads, testPrisma, truncateAll } from '../setup/database';
import { jobOf, manualRequest, staff } from '../setup/fixtures';
import { FakeCatalog, narrationServices } from '../setup/services';

const prisma = testPrisma();

beforeEach(() => truncateAll(prisma));
afterAll(() => prisma.$disconnect());

/** A second fake under another provider's name, so the chain has two. */
function secondFake(): SpeechProvider {
  const provider = new FakeSpeechProvider();
  Object.defineProperty(provider, 'name', { value: 'edge' });
  return provider;
}

describe('provider fallback', () => {
  it('records the fallback provider, then skips the failing primary for the cooldown', async () => {
    const services = narrationServices(prisma, {
      chains: {
        translation: new ProviderChain('translation', [new FakeTranslationProvider()]),
        speech: new ProviderChain('speech', [new FakeSpeechProvider(true), secondFake()]),
      },
    });
    const place = services.catalog.place();
    const { job } = await services.jobs.createManualJob(
      manualRequest(place.id, ['vi', 'en', 'zh-Hans', 'ja', 'ko']),
      staff(),
    );
    await services.queue.drain();
    const done = await jobOf(prisma, job!.id);
    expect(done.status).toBe(SynthesisJobStatus.COMPLETED);
    expect(done.tasks.every((task) => task.speechProvider === 'edge')).toBe(true);

    const [primary, fallback] = services.health
      .providers()
      .filter((provider) => provider.role === 'speech');
    expect(primary).toMatchObject({ name: 'fake', breaker: 'open', position: 0, scope: 'process' });
    expect(primary!.consecutiveFailures).toBeGreaterThanOrEqual(PROVIDER_FAILURE_THRESHOLD - 1);
    expect(primary!.coolingUntil).not.toBeNull();
    // Five tasks, but the primary was only tried until its breaker opened.
    expect(primary!.recentCalls).toBe(PROVIDER_FAILURE_THRESHOLD);
    expect(fallback).toMatchObject({ name: 'edge', breaker: 'closed', errorRate: 0 });

    const listed = services.jobs.listProviders(staff());
    expect(
      listed.providers.find((provider) => provider.name === 'fake' && provider.role === 'speech'),
    ).toMatchObject({
      breaker: 'open',
    });
  });
});

describe('a final failure', () => {
  it('fails the task after its last attempt and reports it final', async () => {
    const catalog = new FakeCatalog();
    const services = narrationServices(prisma, {
      catalog,
      chains: configuredChains({
        TRANSLATION_PROVIDER_ORDER: ['fake'],
        TTS_PROVIDER_ORDER: ['fake'],
        FAKE_PROVIDER_FAILURES: ['translation'],
      }),
    });
    const place = catalog.place();
    const { job } = await services.jobs.createManualJob(manualRequest(place.id, ['en']), staff());
    await services.queue.drain();

    const failed = await jobOf(prisma, job!.id);
    expect(failed.status).toBe(SynthesisJobStatus.FAILED);
    expect(failed.errorSummary).toContain('en:');
    expect(failed.tasks[0]).toMatchObject({
      status: SynthesisTaskStatus.FAILED,
      attempts: 3,
      stage: 'TRANSLATE',
    });
    expect(failed.tasks[0]!.lastError).toContain('fake translation failure');
    const events = await outboxPayloads(prisma, NARRATION_LOCALIZATION_FAILED.subject);
    expect(events.map((event) => event.final)).toEqual([false, false, true]);
    expect(events[2]).toMatchObject({ targetType: 'PLACE', lang: 'en', stage: 'TRANSLATE' });
  });

  it('a retry waits its backoff', async () => {
    const services = narrationServices(prisma, {
      chains: configuredChains({
        TRANSLATION_PROVIDER_ORDER: ['fake'],
        TTS_PROVIDER_ORDER: ['fake'],
        FAKE_PROVIDER_FAILURES: ['translation'],
      }),
    });
    const place = services.catalog.place();
    await services.jobs.createManualJob(manualRequest(place.id, ['en']), staff());
    const first = services.queue.take()!;
    await services.tasks.run(first.taskId);
    const [retry] = [...services.queue.items.values()];
    expect(retry).toMatchObject({ taskId: first.taskId, attempts: 1, delayMs: 5_000 });
  });

  it('a catalog that cannot answer is a retried failure, not a cancel', async () => {
    const services = narrationServices(prisma);
    const place = services.catalog.place();
    await services.jobs.createManualJob(manualRequest(place.id, ['en']), staff());
    services.catalog.down = true;
    const item = services.queue.take()!;
    await services.tasks.run(item.taskId);
    const task = await prisma.synthesisTask.findUniqueOrThrow({ where: { id: item.taskId } });
    expect(task).toMatchObject({ status: SynthesisTaskStatus.QUEUED, attempts: 1 });
  });
});

/** Edge with no network: the WebSocket's `getaddrinfo EAI_AGAIN`, its code on the cause. */
class OfflineSpeech extends FakeSpeechProvider {
  override synthesize(): Promise<Buffer> {
    const cause = Object.assign(new Error('getaddrinfo EAI_AGAIN'), { code: 'EAI_AGAIN' });
    return Promise.reject(new Error('Edge TTS WebSocket error: getaddrinfo EAI_AGAIN', { cause }));
  }
}

describe('a speech provider that cannot be reached (rdm-spec N-2)', () => {
  const outage = () =>
    narrationServices(prisma, {
      chains: {
        translation: new ProviderChain('translation', [new FakeTranslationProvider()]),
        speech: new ProviderChain('speech', [new OfflineSpeech()]),
      },
    });

  it('waits on the outage back-off without spending the attempts', async () => {
    const services = outage();
    const place = services.catalog.place();
    await services.jobs.createManualJob(manualRequest(place.id, ['en']), staff());
    const delays: (number | undefined)[] = [];
    // Five attempts, past the three a task gets: the breaker opens after the third, and a provider
    // cooling down after such failures is still unreachable.
    for (let n = 0; n < 5; n += 1) {
      const item = services.queue.take()!;
      await services.tasks.run(item.taskId);
      delays.push([...services.queue.items.values()][0]?.delayMs);
    }
    expect(delays).toEqual([60_000, 300_000, 900_000, 900_000, 900_000]);
    const task = await prisma.synthesisTask.findFirstOrThrow();
    expect(task).toMatchObject({
      status: SynthesisTaskStatus.QUEUED,
      attempts: 5,
      providerWaits: 5,
      failureReason: SynthesisFailureReason.PROVIDER_UNAVAILABLE,
    });
    expect(task.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 800_000);
    const events = await outboxPayloads(prisma, NARRATION_LOCALIZATION_FAILED.subject);
    expect(events.map((event) => event.final)).toEqual([false, false, false, false, false]);
  });

  it('fails the task once the outage has lasted the window, with one final event', async () => {
    const services = outage();
    const place = services.catalog.place();
    const { job } = await services.jobs.createManualJob(manualRequest(place.id, ['en']), staff());
    await services.tasks.run(services.queue.take()!.taskId);
    await prisma.synthesisTask.updateMany({
      data: { providerDownSince: new Date(Date.now() - PROVIDER_OUTAGE_RETRY_WINDOW_MS) },
    });
    await services.tasks.run(services.queue.take()!.taskId);

    const failed = await jobOf(prisma, job!.id);
    expect(failed.status).toBe(SynthesisJobStatus.FAILED);
    expect(failed.tasks[0]).toMatchObject({
      status: SynthesisTaskStatus.FAILED,
      failureReason: SynthesisFailureReason.PROVIDER_UNAVAILABLE,
    });
    expect(services.queue.items.size).toBe(0);
    const events = await outboxPayloads(prisma, NARRATION_LOCALIZATION_FAILED.subject);
    expect(events.map((event) => event.final)).toEqual([false, true]);
  });

  it('a staff retry starts the task over, outage marks cleared', async () => {
    const services = outage();
    const place = services.catalog.place();
    const { job } = await services.jobs.createManualJob(manualRequest(place.id, ['en']), staff());
    await services.tasks.run(services.queue.take()!.taskId);
    await prisma.synthesisTask.updateMany({
      data: { providerDownSince: new Date(Date.now() - PROVIDER_OUTAGE_RETRY_WINDOW_MS) },
    });
    await services.tasks.run(services.queue.take()!.taskId);
    await services.jobs.retryFailedTasks({ jobId: job!.id }, staff());
    const task = await prisma.synthesisTask.findFirstOrThrow();
    expect(task).toMatchObject({
      attempts: 0,
      providerWaits: 0,
      providerDownSince: null,
      failureReason: null,
      nextAttemptAt: null,
    });
  });
});
