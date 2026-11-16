// The place-content consumer, end to end through the test broker: a published event becomes a job.
import { CATALOG_PLACE_CONTENT_CHANGED, SynthesisJobStatus } from '@wayfare/contracts';
import { ConsumerRunner, ensureStreams, NatsClient } from '@wayfare/nest-common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NARRATION_STREAMS } from '../../src/modules/outbox/outbox.module';
import { PlaceContentConsumer } from '../../src/modules/place-content/place-content.consumer';
import { testConfig, testPrisma, truncateAll } from '../setup/database';
import { jobsOf, placeChanged } from '../setup/fixtures';
import { narrationServices } from '../setup/services';

/** A durable of its own, reading only new messages, so a running narration never competes. */
class TestPlaceContentConsumer extends PlaceContentConsumer {
  override readonly service = 'narration-it';
}

const prisma = testPrisma();
const services = narrationServices(prisma);
const consumer = new TestPlaceContentConsumer(services.jobs);
let nats: NatsClient;
let runner: ConsumerRunner;

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

beforeAll(async () => {
  await truncateAll(prisma);
  nats = await NatsClient.connect(testConfig().get('NATS_URL', { infer: true }), 'narration-it');
  await ensureStreams(nats.jsm, NARRATION_STREAMS);
  await nats.jsm.consumers
    .delete(CATALOG_PLACE_CONTENT_CHANGED.stream, consumer.durable)
    .catch(() => undefined);
  runner = new ConsumerRunner(nats);
  await runner.start([consumer], { deliverPolicy: 'new' });
});

afterAll(async () => {
  await runner.stop();
  await nats.jsm.consumers
    .delete(CATALOG_PLACE_CONTENT_CHANGED.stream, consumer.durable)
    .catch(() => undefined);
  await nats.close();
  await prisma.$disconnect();
});

describe('catalog.place.content_changed over JetStream', () => {
  it('creates the Place job, vi included, once', async () => {
    const place = services.catalog.place();
    const payload = placeChanged(place.id, place.hash, ['en']);
    await nats.js.publish(CATALOG_PLACE_CONTENT_CHANGED.subject, JSON.stringify(payload), {
      msgID: payload.eventId,
    });
    const jobs = await waitFor(
      () => jobsOf(prisma, place.id),
      (rows) => rows.length > 0,
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.status).toBe(SynthesisJobStatus.QUEUED);
    expect(jobs[0]!.requestedLangs.toSorted((a, b) => String(a).localeCompare(String(b)))).toEqual([
      'en',
      'vi',
    ]);
    expect(await prisma.processedEvent.count({ where: { consumer: consumer.durable } })).toBe(1);
  });
});
