// A sync version per language (rdm-spec §1.7): a localization carries its own version, stamped last
// in its transaction, and a language's delta, offline diff and detail ETag move only when the Place
// or the row that language is served from changes — never for another language's translation.
import {
  compareStrings,
  LocalizationTargetType,
  NARRATION_LOCALIZATION_FAILED,
  NARRATION_LOCALIZATION_READY,
  newId,
  PlaceKind,
  PlaceStatus,
  SynthesisStage,
  TranslationSource,
  zOfflineManifest,
  zOfflineManifestDiff,
} from '@wayfare/contracts';
import { localizationReadyFixture } from '@wayfare/contracts/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SNAPSHOT_FORMAT } from '../../src/modules/offline/domain/manifest';
import { menuItemContentHash } from '../../src/modules/places/places.service';
import {
  bumpSyncVersion,
  stampLocalizationVersion,
  withSyncWrite,
} from '../../src/modules/sync/sync.service';
import { testPrisma, truncateAll } from '../setup/database';
import { device, insertPlace, staff, taxonomy } from '../setup/fixtures';
import { catalogServices } from '../setup/services';

const prisma = testPrisma();
let services: ReturnType<typeof catalogServices>;
let tax: Awaited<ReturnType<typeof taxonomy>>;
const READY_CONSUMER = 'catalog-narration-localization-ready';

beforeEach(async () => {
  await truncateAll(prisma);
  services = catalogServices(prisma);
  tax = await taxonomy(prisma);
});
afterAll(() => prisma.$disconnect());

/** Every versioned row older than the sync lag, so the cap reaches it. */
const settle = async () => {
  for (const table of ['places', 'tours', 'place_localizations', 'tour_localizations']) {
    await prisma.$executeRawUnsafe(
      `UPDATE ${table} SET updated_at = updated_at - interval '10 seconds'`,
    );
  }
};

const live = (overrides: Partial<Parameters<typeof insertPlace>[1]> = {}) =>
  insertPlace(prisma, { areaId: tax.area.id, categoryId: tax.any.id, ...overrides });

/** narration's text (and audio) for a Place in one language, through the real consumer. */
const translated = (
  place: { id: string; contentHash: string },
  lang: string,
  over: { audio?: boolean; name?: string } = {},
) =>
  services.localizations.applyReady(
    NARRATION_LOCALIZATION_READY.schema.parse({
      ...localizationReadyFixture({
        placeId: place.id,
        lang,
        sourceContentHash: place.contentHash,
        ...(over.audio === false ? { audioContentHash: null } : {}),
        ...(over.name === undefined ? {} : { name: over.name }),
      }),
    }),
    READY_CONSUMER,
  );

const version = async (placeId: string) =>
  (await prisma.place.findUniqueOrThrow({ where: { id: placeId } })).syncVersion;

const rowVersion = async (placeId: string, lang: string) =>
  (
    await prisma.placeLocalization.findUniqueOrThrow({
      where: { placeId_lang: { placeId, lang } },
    })
  ).syncVersion;

/** The ids a language's delta since `since` lists, with the page's version and completeness. */
const delta = async (lang: string | null, since: bigint, pageSize?: number) => {
  const page = await services.sync.changes({
    areaId: tax.area.id,
    since,
    lang,
    ...(pageSize === undefined ? {} : { pageSize }),
  });
  return {
    ids: page.changes.map((change) => change.id),
    live: page.changes.map((change) => change.live),
    datasetVersion: page.datasetVersion,
    complete: page.complete,
  };
};

describe('the stamp (K1, K2)', () => {
  it("takes the database's clock at the stamp, so a late version stays inside the lag", async () => {
    const place = await live();
    await translated(place, 'fr');
    const started = await withSyncWrite(prisma, async (tx): Promise<Date> => {
      const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT now()`;
      await new Promise((done) => setTimeout(done, 300));
      await stampLocalizationVersion(tx, LocalizationTargetType.PLACE, place.id, 'fr');
      return clock!.now;
    });
    const row = await prisma.placeLocalization.findUniqueOrThrow({
      where: { placeId_lang: { placeId: place.id, lang: 'fr' } },
    });
    expect(row.updatedAt.getTime() - started.getTime()).toBeGreaterThanOrEqual(250);
  });

  it('a long-tail text and its audio failure stamp only their row, never the Place', async () => {
    const place = await live();
    const before = await version(place.id);
    await translated(place, 'fr', { audio: false });
    expect(await version(place.id)).toBe(before);
    const textVersion = await rowVersion(place.id, 'fr');
    expect(textVersion).toBeGreaterThan(before);

    await services.localizations.applyFailed(
      NARRATION_LOCALIZATION_FAILED.schema.parse({
        eventId: newId(),
        occurredAt: new Date().toISOString(),
        targetType: LocalizationTargetType.PLACE,
        targetId: place.id,
        lang: 'fr',
        stage: SynthesisStage.SYNTHESIZE,
        reason: 'NO_VOICE',
        final: true,
      }),
    );
    expect(await version(place.id)).toBe(before);
    expect(await rowVersion(place.id, 'fr')).toBeGreaterThan(textVersion);
  });
});

describe("a language's delta (K3, K4)", () => {
  it('carries a long-tail translation to its own language only, the others complete and empty at the new cap', async () => {
    const place = await live();
    for (const lang of ['en', 'ja', 'vi']) await translated(place, lang);
    await settle();
    const from = await services.sync.cap();

    await translated(place, 'fr');
    await settle();
    for (const lang of ['en', 'ja', 'vi', 'de', null]) {
      const page = await delta(lang, from);
      expect(page, String(lang)).toMatchObject({ ids: [], complete: true });
      expect(page.datasetVersion).toBeGreaterThan(from);
    }
    expect((await delta('fr', from)).ids).toEqual([place.id]);
  });

  it('carries a language row made after its record was served from English', async () => {
    const place = await live();
    await translated(place, 'en');
    await settle();
    const from = await services.sync.cap();
    await translated(place, 'de');
    await settle();
    expect((await delta('de', from)).ids).toEqual([place.id]);
    expect((await delta('en', from)).ids).toEqual([]);
  });

  it('an English change reaches a language served from English, not one with its own row', async () => {
    const own = await live({ name: 'own' });
    const borrowing = await live({ name: 'borrowing' });
    for (const place of [own, borrowing]) {
      await translated(place, 'en', { audio: false });
      await translated(place, 'vi');
    }
    await translated(own, 'ja');
    await settle();
    const from = await services.sync.cap();

    // English re-voiced: its audio arrives for the same text.
    for (const place of [own, borrowing]) await translated(place, 'en');
    await settle();
    expect((await delta('en', from)).ids.sort(compareStrings)).toEqual(
      [own.id, borrowing.id].sort(compareStrings),
    );
    expect((await delta(null, from)).ids.sort(compareStrings)).toEqual(
      [own.id, borrowing.id].sort(compareStrings),
    );
    expect((await delta('ja', from)).ids).toEqual([borrowing.id]);
    // Vietnamese never falls back to English.
    expect((await delta('vi', from)).ids).toEqual([]);
  });

  it('Vietnamese follows its own row; an unsupported language follows English', async () => {
    const place = await live();
    await settle();
    const from = await services.sync.cap();
    await translated(place, 'vi');
    await settle();
    expect((await delta('vi', from)).ids).toEqual([place.id]);
    expect((await delta(null, from)).ids).toEqual([]);
  });

  it('a change to the Place reaches every language, live or removed', async () => {
    const place = await live();
    for (const lang of ['en', 'fr']) await translated(place, lang);
    await settle();
    const from = await services.sync.cap();
    await prisma.place.update({
      where: { id: place.id },
      data: { status: PlaceStatus.INACTIVE, inactiveReason: 'ADMIN' },
    });
    await withSyncWrite(prisma, (tx) => bumpSyncVersion(tx, place.id));
    await settle();
    for (const lang of ['en', 'fr', 'ja', 'vi', null]) {
      expect(await delta(lang, from), String(lang)).toMatchObject({
        ids: [place.id],
        live: [false],
      });
    }
  });

  it('pages over mixed versions, each page ending at its last version for the language', async () => {
    const places = [await live(), await live(), await live(), await live()];
    await settle();
    const from = await services.sync.cap();
    // Two changed by a French text, two by themselves, interleaved in version order.
    await translated(places[0]!, 'fr');
    await withSyncWrite(prisma, (tx) => bumpSyncVersion(tx, places[1]!.id));
    await translated(places[2]!, 'fr');
    await withSyncWrite(prisma, (tx) => bumpSyncVersion(tx, places[3]!.id));
    await settle();

    const first = await delta('fr', from, 3);
    expect(first.complete).toBe(false);
    expect(first.ids).toEqual(places.slice(0, 3).map((place) => place.id));
    expect(first.datasetVersion).toBe(await rowVersion(places[2]!.id, 'fr'));
    const rest = await delta('fr', first.datasetVersion, 3);
    expect(rest).toMatchObject({ ids: [places[3]!.id], complete: true });
    // English sees only the Places that changed themselves.
    expect((await delta('en', from)).ids).toEqual([places[1]!.id, places[3]!.id]);
  });

  it("counts no version above the cap: a translation still inside the lag is the next delta's", async () => {
    const place = await live();
    await settle();
    const from = await services.sync.cap();
    await translated(place, 'fr');
    const page = await delta('fr', from);
    expect(page).toMatchObject({ ids: [], complete: true, datasetVersion: from });
    await settle();
    expect((await delta('fr', from)).ids).toEqual([place.id]);
  });

  it('leaves menu translations out of the cap', async () => {
    const venue = await live({ kind: PlaceKind.VENUE, categoryId: tax.venueOnly.id });
    const item = await prisma.menuItem.create({
      data: {
        placeId: venue.id,
        nameVi: 'Phở bò',
        contentHash: menuItemContentHash('Phở bò', null),
        sortOrder: 0,
      },
    });
    await settle();
    const cap = await services.sync.cap();
    await services.localizations.applyReady(
      NARRATION_LOCALIZATION_READY.schema.parse({
        ...localizationReadyFixture({
          placeId: item.id,
          lang: 'en',
          sourceContentHash: item.contentHash,
          audioContentHash: null,
        }),
        targetType: LocalizationTargetType.MENU_ITEM,
        text: { name: 'Beef pho' },
      }),
      READY_CONSUMER,
    );
    await prisma.$executeRaw`
      UPDATE menu_item_localizations SET updated_at = updated_at - interval '10 seconds'`;
    expect(await services.sync.cap()).toBe(cap);
  });
});

describe('tours (K3)', () => {
  it("carry a long-tail translation to its own language's delta only", async () => {
    const [a, b] = [await live(), await live()];
    const { tour } = await services.tours.createTour(
      {
        titleVi: 'Danh thắng',
        descriptionVi: 'Một vòng đi bộ.',
        areaId: tax.area.id,
        estimatedMinutes: 90,
        placeIds: [a.id, b.id],
        requestActivation: true,
      },
      staff(),
    );
    const tourText = (lang: string) =>
      services.localizations.applyReady(
        NARRATION_LOCALIZATION_READY.schema.parse({
          eventId: newId(),
          occurredAt: new Date().toISOString(),
          targetType: LocalizationTargetType.TOUR,
          targetId: tour!.id,
          lang,
          sourceContentHash: tour!.contentHash,
          translationSource: TranslationSource.MACHINE,
          text: { title: `[${lang}] Landmarks`, description: `[${lang}] A walk.` },
        }),
        READY_CONSUMER,
      );
    await tourText('en');
    await settle();
    const from = await services.sync.cap();
    await tourText('fr');
    await settle();
    const changes = (lang: string) =>
      services.sync.tourChanges({ areaId: tax.area.id, since: from, lang });
    expect((await changes('en')).changes).toEqual([]);
    expect((await changes('ja')).changes).toEqual([]);
    expect((await changes('fr')).changes.map((change) => change.id)).toEqual([tour!.id]);
    const synced = await services.tourQueries.syncTours(
      { areaId: tax.area.id, lang: 'en', since: String(from) },
      device(),
    );
    expect(synced).toMatchObject({ tours: [], complete: true });
  });
});

describe("the detail's ETag (K5)", () => {
  it('moves for its own language, for English when it has no row, and for its menu', async () => {
    const venue = await live({ kind: PlaceKind.VENUE, categoryId: tax.venueOnly.id });
    const item = await prisma.menuItem.create({
      data: {
        placeId: venue.id,
        nameVi: 'Phở bò',
        contentHash: menuItemContentHash('Phở bò', null),
        sortOrder: 0,
      },
    });
    await translated(venue, 'en');
    const etag = async (lang: string) =>
      (await services.queries.getPlace({ placeId: venue.id, lang }, device())).place!;
    const before = { en: await etag('en'), ja: await etag('ja') };

    await translated(venue, 'fr');
    expect((await etag('en')).etagVersion).toBe(before.en.etagVersion);
    expect((await etag('ja')).etagVersion).toBe(before.ja.etagVersion);
    expect(BigInt((await etag('fr')).etagVersion)).toBeGreaterThan(BigInt(before.en.etagVersion));
    // `syncVersion` keeps meaning the Place's own version.
    expect((await etag('fr')).syncVersion).toBe(before.en.syncVersion);

    // English changes: the languages served from it move (Japanese has no row), French doesn't.
    const french = (await etag('fr')).etagVersion;
    await translated(venue, 'en', { name: 'Renamed' });
    expect((await etag('ja')).etagVersion).not.toBe(before.ja.etagVersion);
    expect((await etag('fr')).etagVersion).toBe(french);

    // A menu line's translation moves the languages it's served in.
    const english = (await etag('en')).etagVersion;
    await services.localizations.applyReady(
      NARRATION_LOCALIZATION_READY.schema.parse({
        ...localizationReadyFixture({
          placeId: item.id,
          lang: 'en',
          sourceContentHash: item.contentHash,
          audioContentHash: null,
        }),
        targetType: LocalizationTargetType.MENU_ITEM,
        text: { name: 'Beef pho' },
      }),
      READY_CONSUMER,
    );
    expect(BigInt((await etag('en')).etagVersion)).toBeGreaterThan(BigInt(english));
    expect((await etag('fr')).etagVersion).not.toBe(french);
  });
});

describe('offline (K6)', () => {
  it("an English pack's diff and snapshot ignore a French translation", async () => {
    const place = await live();
    await translated(place, 'en');
    await settle();
    const manifest = zOfflineManifest.parse(
      JSON.parse(
        (await services.offline.getManifest({ areaId: tax.area.id, lang: 'en' }, device()))
          .manifestJson,
      ),
    );
    expect(manifest.places.path).toContain(`/v${SNAPSHOT_FORMAT}-`);
    expect(SNAPSHOT_FORMAT).toBe(3);

    await translated(place, 'fr');
    await settle();
    const diff = zOfflineManifestDiff.parse(
      JSON.parse(
        (
          await services.offline.getManifestDiff(
            {
              areaId: tax.area.id,
              lang: 'en',
              fromDatasetVersion: String(manifest.datasetVersion),
              fromMapPackVersion: 0,
            },
            device(),
          )
        ).diffJson,
      ),
    );
    expect(diff.changedPlaceIds).toEqual([]);
    expect(diff.removedPlaceIds).toEqual([]);
    expect(diff.places.path).toBe(manifest.places.path);
  });
});

describe('the migration (K7)', () => {
  it("gives every localization its parent's version, and keeps a previous image's inserts carried", async () => {
    const place = await live();
    // As a row from before the release: inserted with no version of its own.
    await prisma.$executeRaw`
      INSERT INTO place_localizations (place_id, lang, name, description, source_content_hash,
                                       translation_source, audio_status)
      VALUES (${place.id}::uuid, 'ko', 'name-ko', 'description-ko', ${place.contentHash},
              'MACHINE', 'PENDING')`;
    expect(await rowVersion(place.id, 'ko')).toBe(0n);

    // The migration's backfill, as it ran on the stored rows.
    await prisma.$executeRaw`
      UPDATE place_localizations l SET sync_version = p.sync_version
      FROM places p WHERE p.id = l.place_id`;
    expect(await rowVersion(place.id, 'ko')).toBe(await version(place.id));
    await settle();
    const from = await services.sync.cap();
    for (const lang of ['ko', 'en', null]) expect((await delta(lang, from)).ids).toEqual([]);

    // The previous image during a rolling deploy: its row at 0, and its own bump of the Place.
    await prisma.$executeRaw`
      INSERT INTO place_localizations (place_id, lang, name, description, source_content_hash,
                                       translation_source, audio_status)
      VALUES (${place.id}::uuid, 'th', 'name-th', 'description-th', ${place.contentHash},
              'MACHINE', 'PENDING')`;
    await withSyncWrite(prisma, (tx) => bumpSyncVersion(tx, place.id));
    await settle();
    expect(await rowVersion(place.id, 'th')).toBe(0n);
    expect((await delta('th', from)).ids).toEqual([place.id]);
  });
});
