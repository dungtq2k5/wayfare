import {
  AUDIT_RECORD,
  CATALOG_PLACE_STATUS_CHANGED,
  LocalizationTargetType,
  NARRATION_LOCALIZATION_FAILED,
  NARRATION_LOCALIZATION_READY,
  newId,
  PlaceKind,
  PlaceStatus,
  SynthesisStage,
} from '@wayfare/contracts';
import type { EventPayload } from '@wayfare/contracts';
import { localizationReadyFixture } from '@wayfare/contracts/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { menuItemContentHash } from '../../src/modules/places/places.service';
import { testPrisma, truncateAll } from '../setup/database';
import { insertPlace, outboxPayloads, taxonomy } from '../setup/fixtures';
import { catalogServices } from '../setup/services';

const prisma = testPrisma();
const { localizations } = catalogServices(prisma);
const READY_CONSUMER = 'catalog-narration-localization-ready';
const OLD = '0'.repeat(64);
let tax: Awaited<ReturnType<typeof taxonomy>>;

beforeEach(async () => {
  await truncateAll(prisma);
  tax = await taxonomy(prisma);
});
afterAll(() => prisma.$disconnect());

type Ready = EventPayload<typeof NARRATION_LOCALIZATION_READY>;

/** A parsed ready event, as the consumer receives it. */
const ready = (input: Parameters<typeof localizationReadyFixture>[0]): Ready =>
  NARRATION_LOCALIZATION_READY.schema.parse(localizationReadyFixture(input));

const apply = (payload: Ready) => localizations.applyReady(payload, READY_CONSUMER);

const row = (placeId: string, lang: string) =>
  prisma.placeLocalization.findUnique({ where: { placeId_lang: { placeId, lang } } });

const place = (id: string) => prisma.place.findUniqueOrThrow({ where: { id } });

async function processing() {
  return insertPlace(prisma, {
    areaId: tax.area.id,
    categoryId: tax.any.id,
    status: PlaceStatus.PROCESSING,
  });
}

describe('narration.localization.ready for a Place', () => {
  it('opens the gate only on the event that completes it', async () => {
    const { id, contentHash } = await processing();
    const before = (await place(id)).syncVersion;
    await apply(ready({ placeId: id, lang: 'vi', sourceContentHash: contentHash }));
    await apply(
      ready({ placeId: id, lang: 'en', sourceContentHash: contentHash, audioContentHash: null }),
    );
    expect((await place(id)).status).toBe(PlaceStatus.PROCESSING);
    expect((await place(id)).syncVersion).toBeGreaterThan(before);

    await apply(ready({ placeId: id, lang: 'en', sourceContentHash: contentHash }));
    const opened = await place(id);
    expect(opened.status).toBe(PlaceStatus.ACTIVE);
    expect(opened.publishedAt).not.toBeNull();
    expect(await outboxPayloads(prisma, CATALOG_PLACE_STATUS_CHANGED.subject)).toEqual([
      expect.objectContaining({ placeId: id, from: 'PROCESSING', to: 'ACTIVE', deleted: false }),
    ]);
    expect(await outboxPayloads(prisma, AUDIT_RECORD.subject)).toEqual([
      expect.objectContaining({
        action: 'PLACE_ACTIVATED',
        actor: { type: 'SYSTEM' },
        service: 'catalog',
      }),
    ]);
  });

  it('never opens without an activation request, nor for another language', async () => {
    const draft = await insertPlace(prisma, {
      areaId: tax.area.id,
      categoryId: tax.any.id,
      status: PlaceStatus.DRAFT,
    });
    await apply(ready({ placeId: draft.id, lang: 'en', sourceContentHash: draft.contentHash }));
    expect((await place(draft.id)).status).toBe(PlaceStatus.DRAFT);
    const pending = await processing();
    await apply(ready({ placeId: pending.id, lang: 'ja', sourceContentHash: pending.contentHash }));
    expect((await place(pending.id)).status).toBe(PlaceStatus.PROCESSING);
  });

  it('a replay changes nothing', async () => {
    const { id, contentHash } = await processing();
    const event = ready({ placeId: id, lang: 'en', sourceContentHash: contentHash });
    await apply(event);
    const first = await place(id);
    await apply(event);
    const second = await place(id);
    expect(second.syncVersion).toBe(first.syncVersion);
    expect(await outboxPayloads(prisma, CATALOG_PLACE_STATUS_CHANGED.subject)).toHaveLength(1);
    expect(
      await prisma.processedEvent.count({
        where: { consumer: READY_CONSUMER, eventId: event.eventId },
      }),
    ).toBe(1);
  });

  it('an event for an old hash after a current one leaves the row current', async () => {
    const { id, contentHash } = await processing();
    await apply(
      ready({ placeId: id, lang: 'ja', sourceContentHash: contentHash, name: 'current' }),
    );
    await apply(ready({ placeId: id, lang: 'ja', sourceContentHash: OLD, name: 'late' }));
    expect(await row(id, 'ja')).toMatchObject({ name: 'current', sourceContentHash: contentHash });
  });

  it('stale text is replaced by stale text, and beats no text', async () => {
    const { id } = await processing();
    const older = '1'.repeat(64);
    await apply(ready({ placeId: id, lang: 'ko', sourceContentHash: OLD, name: 'first' }));
    await apply(ready({ placeId: id, lang: 'ko', sourceContentHash: older, name: 'second' }));
    expect(await row(id, 'ko')).toMatchObject({ name: 'second', sourceContentHash: older });
  });

  it('current audio is not replaced by stale audio, but current text keeps coming', async () => {
    const { id, contentHash } = await processing();
    await apply(ready({ placeId: id, lang: 'en', sourceContentHash: contentHash }));
    const current = await row(id, 'en');
    // A stale text with stale audio: neither is written.
    await apply(ready({ placeId: id, lang: 'en', sourceContentHash: OLD, audioContentHash: OLD }));
    expect(await row(id, 'en')).toMatchObject({
      audioSourceContentHash: contentHash,
      audioObjectPath: current!.audioObjectPath,
      sourceContentHash: contentHash,
    });
    // A human correction of the current text: text and audio both replaced.
    await apply({
      ...ready({ placeId: id, lang: 'en', sourceContentHash: contentHash, name: 'fixed' }),
      translationSource: 'HUMAN' as never,
    });
    expect(await row(id, 'en')).toMatchObject({ name: 'fixed', translationSource: 'HUMAN' });
  });

  it('text for a new hash keeps the old audio until its own arrives', async () => {
    const { id, contentHash } = await insertPlace(prisma, {
      areaId: tax.area.id,
      categoryId: tax.any.id,
      status: PlaceStatus.PROCESSING,
    });
    await apply(ready({ placeId: id, lang: 'en', sourceContentHash: OLD }));
    await apply(
      ready({ placeId: id, lang: 'en', sourceContentHash: contentHash, audioContentHash: null }),
    );
    expect(await row(id, 'en')).toMatchObject({
      sourceContentHash: contentHash,
      audioStatus: 'READY',
      audioSourceContentHash: OLD,
    });
    expect((await place(id)).status).toBe(PlaceStatus.PROCESSING);
  });

  it('acknowledges an unknown Place, a tour and an offer', async () => {
    await expect(
      apply(ready({ placeId: newId(), lang: 'en', sourceContentHash: OLD })),
    ).resolves.toBeUndefined();
    for (const targetType of [LocalizationTargetType.TOUR, LocalizationTargetType.VOUCHER_OFFER]) {
      await expect(
        apply({
          ...ready({ placeId: newId(), lang: 'en', sourceContentHash: OLD }),
          targetType,
        } as never),
      ).resolves.toBeUndefined();
    }
  });
});

describe('narration.localization.ready for a menu item', () => {
  it('writes the current text, bumps the Place, and ignores a removed item', async () => {
    const venue = await insertPlace(prisma, {
      areaId: tax.area.id,
      categoryId: tax.venueOnly.id,
      kind: PlaceKind.VENUE,
    });
    const hash = menuItemContentHash('Phở bò', null);
    const item = await prisma.menuItem.create({
      data: { placeId: venue.id, nameVi: 'Phở bò', contentHash: hash, sortOrder: 0 },
    });
    const before = (await place(venue.id)).syncVersion;
    const event = (targetId: string, sourceContentHash: string, name: string): Ready => ({
      ...ready({ placeId: targetId, lang: 'en', sourceContentHash }),
      targetType: LocalizationTargetType.MENU_ITEM,
      text: { name },
      audio: undefined,
    });
    await apply(event(item.id, hash, 'Beef pho'));
    await apply(event(item.id, OLD, 'Old pho'));
    expect(
      await prisma.menuItemLocalization.findUnique({
        where: { menuItemId_lang: { menuItemId: item.id, lang: 'en' } },
      }),
    ).toMatchObject({ name: 'Beef pho', description: null, sourceContentHash: hash });
    expect((await place(venue.id)).syncVersion).toBeGreaterThan(before);
    await expect(apply(event(newId(), hash, 'Gone'))).resolves.toBeUndefined();
  });
});

describe('narration.localization.failed', () => {
  const failed = (targetId: string, lang: string, final: boolean) =>
    localizations.applyFailed(
      NARRATION_LOCALIZATION_FAILED.schema.parse({
        eventId: newId(),
        occurredAt: new Date().toISOString(),
        targetType: LocalizationTargetType.PLACE,
        targetId,
        lang,
        stage: SynthesisStage.SYNTHESIZE,
        reason: 'Provider error',
        final,
      }),
    );

  it('marks audio FAILED on a final failure, keeping the text', async () => {
    const { id, contentHash } = await processing();
    await apply(
      ready({ placeId: id, lang: 'en', sourceContentHash: contentHash, audioContentHash: null }),
    );
    await failed(id, 'en', false);
    expect(await row(id, 'en')).toMatchObject({ audioStatus: 'PENDING' });
    await failed(id, 'en', true);
    expect(await row(id, 'en')).toMatchObject({
      audioStatus: 'FAILED',
      name: 'Place (en)',
      sourceContentHash: contentHash,
    });
  });

  it('never overrides READY audio for the current text, and ignores a stale row', async () => {
    const { id, contentHash } = await processing();
    await apply(ready({ placeId: id, lang: 'en', sourceContentHash: contentHash }));
    await failed(id, 'en', true);
    expect(await row(id, 'en')).toMatchObject({ audioStatus: 'READY' });
    await apply(ready({ placeId: id, lang: 'ja', sourceContentHash: OLD }));
    await failed(id, 'ja', true);
    expect(await row(id, 'ja')).toMatchObject({
      audioStatus: 'READY',
      audioSourceContentHash: OLD,
    });
  });

  it('replaces old audio for a current text with FAILED, dropping the file', async () => {
    const { id, contentHash } = await processing();
    await apply(ready({ placeId: id, lang: 'ko', sourceContentHash: OLD }));
    await apply(
      ready({ placeId: id, lang: 'ko', sourceContentHash: contentHash, audioContentHash: null }),
    );
    await failed(id, 'ko', true);
    expect(await row(id, 'ko')).toMatchObject({
      audioStatus: 'FAILED',
      audioSourceContentHash: null,
      audioObjectPath: null,
    });
  });
});
