// The UI strings both apps read (api-endpoints-plan §4.2, rdm-spec N-6): a committed locale served
// from the files, any other machine-translated once — with the placeholder check that keeps
// "You have  places" out of production — and only three versions kept.
import {
  UI_BUNDLE_KEEP_VERSIONS,
  UiBundleNamespace,
  UiBundleOrigin,
  UiBundleStatus,
} from '@wayfare/contracts';
import { uiBundleStatusProto } from '@wayfare/contracts/grpc';
import { bundleSourceHash, readUiBundle } from '@wayfare/i18n';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeTranslationProvider } from '../../src/providers/translation/fake.translation-provider';
import { seedSystemBundles } from '../../src/scripts/seed-system-bundles';
import { testPrisma, truncateAll } from '../setup/database';
import { narrationServices } from '../setup/services';
import { buildAnonymousContext } from '@wayfare/nest-common/testing';

const prisma = testPrisma();
let services: ReturnType<typeof narrationServices>;
const anyone = buildAnonymousContext();
const TOURIST = UiBundleNamespace.TOURIST;
const READY = uiBundleStatusProto.toProto(UiBundleStatus.READY);
const PENDING = uiBundleStatusProto.toProto(UiBundleStatus.PENDING);

beforeEach(async () => {
  await truncateAll(prisma);
  services = narrationServices(prisma);
});
afterAll(() => prisma.$disconnect());

const bundle = (locale: string, namespace: string = TOURIST) =>
  services.bundles.getBundle({ namespace, locale }, anyone);

describe('a committed locale', () => {
  it('is served from the files, as the version they hash to', async () => {
    const answer = await bundle('vi');
    expect(answer).toMatchObject({
      namespace: TOURIST,
      locale: 'vi',
      status: READY,
      sourceHash: bundleSourceHash('tourist'),
      failedKeys: [],
    });
    expect(answer.messages['nav.explore']).toBe('Khám phá');
    expect(answer.messages['category.MUSEUM']).toBe('Bảo tàng');
    // Recorded as a system row, so the seeder and the route agree on what exists.
    const row = await prisma.uiBundle.findFirstOrThrow();
    expect(row).toMatchObject({ origin: UiBundleOrigin.STATIC, status: UiBundleStatus.READY });
    expect(services.bundleQueue.items).toEqual([]);
  });

  it('is what the seeder writes, in every namespace, and writing twice changes nothing', async () => {
    const first = await seedSystemBundles(prisma);
    expect(first.filter((line) => line.startsWith('created'))).toHaveLength(4);
    const second = await seedSystemBundles(prisma);
    expect(second.every((line) => line.startsWith('unchanged'))).toBe(true);
    expect(await prisma.uiBundle.count()).toBe(4);
  });

  it('falls back to English for a tag narration does not serve', async () => {
    const answer = await bundle('qq');
    expect(answer).toMatchObject({ locale: 'en', status: READY });
    expect(answer.messages['nav.explore']).toBe('Explore');
  });
});

describe('an uncommitted locale', () => {
  it('is answered in English at once, queued, and Thai on the next ask', async () => {
    const pending = await bundle('th');
    expect(pending).toMatchObject({ locale: 'th', status: PENDING, retryAfterMs: 5_000 });
    // English now, so the app renders something immediately (rdm-spec N-6).
    expect(pending.messages['nav.explore']).toBe('Explore');
    expect(services.bundleQueue.items.map(({ item }) => item)).toEqual([
      { namespace: TOURIST, locale: 'th', sourceHash: bundleSourceHash('tourist'), attempt: 1 },
    ]);

    // Asking again while it is being made queues nothing more.
    await bundle('th');
    expect(services.bundleQueue.items).toHaveLength(1);

    await services.bundleQueue.drain();
    const ready = await bundle('th');
    expect(ready.status).toBe(READY);
    expect(ready.messages['nav.explore']).toBe('[th] Explore');
    expect(ready.failedKeys).toEqual([]);
    const row = await prisma.uiBundle.findFirstOrThrow();
    expect(row.origin).toBe(UiBundleOrigin.MACHINE);
  });

  it('keeps English for a key whose translation lost a placeholder', async () => {
    const source = readUiBundle('en', 'tourist');
    const dropped = 'language.switching';
    vi.spyOn(FakeTranslationProvider.prototype, 'translate').mockImplementation(
      ({ text, to }: { text: string; to: string }) =>
        Promise.resolve(
          text === source[dropped] ? 'Đang chuẩn bị các địa điểm…' : `[${to}] ${text}`,
        ),
    );
    await bundle('th');
    await services.bundleQueue.drain();
    const ready = await bundle('th');
    vi.restoreAllMocks();

    expect(ready.failedKeys).toEqual([dropped]);
    // The key that lost `{count}` is served in English; every other key is translated.
    expect(ready.messages[dropped]).toBe(source[dropped]);
    expect(ready.messages['nav.explore']).toBe('[th] Explore');
  });

  it('is left PENDING and served English when the provider keeps failing', async () => {
    vi.spyOn(FakeTranslationProvider.prototype, 'translate').mockRejectedValue(
      new Error('provider down'),
    );
    await bundle('th');
    await services.bundleQueue.drain();
    vi.restoreAllMocks();

    const again = await bundle('th');
    expect(again.status).toBe(PENDING);
    expect(again.messages['nav.explore']).toBe('Explore');
    expect((await prisma.uiBundle.findFirstOrThrow()).status).toBe(UiBundleStatus.PENDING);
  });
});

describe('the three-version rule', () => {
  it('keeps the newest versions and drops the oldest on write', async () => {
    const olderHashes = Array.from({ length: UI_BUNDLE_KEEP_VERSIONS }, (_, index) =>
      String(index).repeat(64).slice(0, 64),
    );
    for (const sourceHash of olderHashes) {
      await prisma.uiBundle.create({
        data: {
          namespace: TOURIST,
          locale: 'vi',
          sourceHash,
          status: UiBundleStatus.READY,
          origin: UiBundleOrigin.STATIC,
          messages: { 'nav.explore': 'cũ' },
          failedKeys: [],
        },
      });
    }
    // The current source is a fourth version: the oldest goes.
    await bundle('vi');
    const kept = await prisma.uiBundle.findMany({
      where: { namespace: TOURIST, locale: 'vi' },
      orderBy: { createdAt: 'asc' },
      select: { sourceHash: true },
    });
    expect(kept).toHaveLength(UI_BUNDLE_KEEP_VERSIONS);
    expect(kept.map((row) => row.sourceHash)).not.toContain(olderHashes[0]);
    expect(kept.at(-1)!.sourceHash).toBe(bundleSourceHash('tourist'));
  });

  it('never serves a PENDING row as READY', async () => {
    await bundle('th');
    const answer = await bundle('th');
    expect(answer.status).toBe(PENDING);
    expect(answer.messages).toEqual(readUiBundle('en', 'tourist'));
  });
});
