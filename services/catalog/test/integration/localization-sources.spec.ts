import {
  HOTSET_MAX_PLACES,
  HOTSET_RADIUS_M,
  newId,
  PlaceKind,
  PlaceStatus,
} from '@wayfare/contracts';
import { catalogGrpc, localizationGrpc } from '@wayfare/contracts/grpc';
import { FIXTURE_INSIDE } from '@wayfare/contracts/testing';
import { buildAnonymousContext } from '@wayfare/nest-common/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { LocalizationSourcesService } from '../../src/modules/localization-sources/localization-sources.service';
import { menuItemContentHash } from '../../src/modules/places/places.service';
import { testPrisma, truncateAll } from '../setup/database';
import { errorOf, insertLocalization, insertPlace, taxonomy } from '../setup/fixtures';

const prisma = testPrisma();
const sources = new LocalizationSourcesService(prisma);
const T = localizationGrpc.LocalizationTargetType;
// Consumers call with a system context: no account.
const system = buildAnonymousContext();
let tax: Awaited<ReturnType<typeof taxonomy>>;

beforeEach(async () => {
  await truncateAll(prisma);
  tax = await taxonomy(prisma);
});
afterAll(() => prisma.$disconnect());

const source = (targetType: number, targetId: string) =>
  sources.getLocalizationSource({ targetType, targetId }, system);

describe('GetLocalizationSource', () => {
  it('returns a Place with its text and every localization, audio as an object path', async () => {
    const place = await insertPlace(prisma, {
      areaId: tax.area.id,
      categoryId: tax.any.id,
      status: PlaceStatus.PROCESSING,
      name: 'Chợ',
      description: 'Mô tả.',
    });
    await insertLocalization(prisma, place.id, 'en', place.contentHash);
    await insertLocalization(prisma, place.id, 'ja', place.contentHash, { audioHash: null });
    const { place: found } = await source(T.LOCALIZATION_TARGET_TYPE_PLACE, place.id);
    expect(found).toMatchObject({
      kind: catalogGrpc.PlaceKind.PLACE_KIND_EDITORIAL,
      status: catalogGrpc.PlaceStatus.PLACE_STATUS_PROCESSING,
      deleted: false,
      contentHash: place.contentHash,
      nameVi: 'Chợ',
      descriptionVi: 'Mô tả.',
    });
    expect(found!.localizations).toEqual([
      expect.objectContaining({
        lang: 'en',
        audioStatus: catalogGrpc.AudioStatus.AUDIO_STATUS_READY,
        audioObjectPath: expect.stringMatching(/^audio\//) as string,
      }),
      expect.objectContaining({
        lang: 'ja',
        audioStatus: catalogGrpc.AudioStatus.AUDIO_STATUS_PENDING,
      }),
    ]);
    expect(found!.localizations[1]).not.toHaveProperty('audioObjectPath');
  });

  it('returns a deleted Place flagged, and not_found for an unknown one', async () => {
    const place = await insertPlace(prisma, {
      areaId: tax.area.id,
      categoryId: tax.any.id,
      deleted: true,
    });
    expect((await source(T.LOCALIZATION_TARGET_TYPE_PLACE, place.id)).place?.deleted).toBe(true);
    expect(await source(T.LOCALIZATION_TARGET_TYPE_PLACE, newId())).toEqual({ notFound: {} });
  });

  it('returns a menu item, and not_found once it is gone or for a tour', async () => {
    const venue = await insertPlace(prisma, {
      areaId: tax.area.id,
      categoryId: tax.venueOnly.id,
      kind: PlaceKind.VENUE,
    });
    const hash = menuItemContentHash('Phở', null);
    const item = await prisma.menuItem.create({
      data: { placeId: venue.id, nameVi: 'Phở', contentHash: hash, sortOrder: 0 },
    });
    expect(await source(T.LOCALIZATION_TARGET_TYPE_MENU_ITEM, item.id)).toEqual({
      menuItem: { placeId: venue.id, contentHash: hash, nameVi: 'Phở' },
    });
    await prisma.menuItem.delete({ where: { id: item.id } });
    expect(await source(T.LOCALIZATION_TARGET_TYPE_MENU_ITEM, item.id)).toEqual({ notFound: {} });
    expect(await source(T.LOCALIZATION_TARGET_TYPE_TOUR, newId())).toEqual({ notFound: {} });
  });

  it('refuses a missing target type', async () => {
    expect((await errorOf(source(0, newId()))).code).toBe('VALIDATION_FAILED');
  });
});

describe('SearchLocalizedText', () => {
  /** A live Place whose English text holds `text`. */
  async function localized(name: string, text: string, status = PlaceStatus.ACTIVE) {
    const place = await insertPlace(prisma, {
      areaId: tax.area.id,
      categoryId: tax.any.id,
      status,
      name,
    });
    await prisma.placeLocalization.create({
      data: {
        placeId: place.id,
        lang: 'en',
        name,
        description: text,
        sourceContentHash: place.contentHash,
        translationSource: 'MACHINE',
        audioStatus: 'PENDING',
      },
    });
    return place;
  }

  const search = (term: string, over: Partial<catalogGrpc.SearchLocalizedTextRequest> = {}) =>
    sources.searchLocalizedText({ term, langs: [], page: undefined, ...over }, system);

  it('matches whole words with their diacritics, and only live targets', async () => {
    const market = await localized('Chợ', 'The market at Bến Thành is busy.');
    await localized('Khác', 'Ben Thanh without diacritics is another term.');
    await localized('Dính', 'Nothing here says BếnThành as one word.');
    await localized('Ẩn', 'Bến Thành again.', PlaceStatus.DRAFT);

    const { items } = await search('Bến Thành');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      targetType: localizationGrpc.LocalizationTargetType.LOCALIZATION_TARGET_TYPE_PLACE,
      targetId: market.id,
      lang: 'en',
      sourceContentHash: market.contentHash,
    });
    // Case-insensitive, and a name matches as well as a description.
    expect((await search('bến thành')).items).toHaveLength(1);
    expect((await search('Chợ')).items.map((item) => item.targetId)).toEqual([market.id]);
    // A whole word inside the phrase matches; a fragment of one does not.
    expect((await search('Thành')).items.map((item) => item.targetId)).toEqual([market.id]);
    expect((await search('Bến Thàn')).items).toEqual([]);
  });

  it('searches menu items too, filters by language, and pages with a cursor', async () => {
    const place = await localized('Quán', 'Phở bò every morning.');
    const item = await prisma.menuItem.create({
      data: {
        placeId: place.id,
        nameVi: 'Phở bò',
        contentHash: menuItemContentHash('Phở bò', null),
        priceMinor: 45_000,
        sortOrder: 0,
      },
      select: { id: true, contentHash: true },
    });
    for (const lang of ['en', 'ja']) {
      await prisma.menuItemLocalization.create({
        data: {
          menuItemId: item.id,
          lang,
          name: 'Phở bò',
          sourceContentHash: item.contentHash,
          translationSource: 'MACHINE',
        },
      });
    }

    const all = await search('Phở bò');
    expect(all.items).toHaveLength(3);
    expect(new Set(all.items.map((match) => match.targetType))).toHaveLength(2);
    expect((await search('Phở bò', { langs: ['ja'] })).items).toHaveLength(1);

    const first = await search('Phở bò', { page: { cursor: undefined, limit: 2 } });
    expect(first.items).toHaveLength(2);
    const second = await search('Phở bò', {
      page: { cursor: first.page!.nextCursor, limit: 2 },
    });
    expect(second.items).toHaveLength(1);
    expect(second.page!.nextCursor).toBeUndefined();
    const byId = (a: string, b: string) => a.localeCompare(b);
    expect([...first.items, ...second.items].map((match) => match.targetId).sort(byId)).toEqual(
      all.items.map((match) => match.targetId).sort(byId),
    );
  });

  it('refuses a term that is too short or too long, and a malformed cursor', async () => {
    expect((await errorOf(search('a'))).code).toBe('VALIDATION_FAILED');
    expect((await errorOf(search('x'.repeat(121)))).code).toBe('VALIDATION_FAILED');
    expect(
      (await errorOf(search('Bến Thành', { page: { cursor: 'nonsense', limit: 10 } }))).details,
    ).toEqual({ issues: [{ path: '/cursor', code: 'invalid_value' }] });
  });

  it('treats a regex character in the term as text, boundary or not', async () => {
    const place = await localized('Dấu', 'A place called C++ Coffee.');
    // `\M` cannot follow `+`, so the right boundary is dropped rather than matching nothing.
    expect((await search('C++')).items.map((match) => match.targetId)).toEqual([place.id]);
    expect((await search('C..')).items).toEqual([]);
  });
});

describe('ListNarrationCandidates', () => {
  const candidates = (over: Partial<catalogGrpc.ListNarrationCandidatesRequest> = {}) =>
    sources.listNarrationCandidates(
      {
        lat: FIXTURE_INSIDE.lat,
        lng: FIXTURE_INSIDE.lng,
        radiusM: HOTSET_RADIUS_M,
        limit: HOTSET_MAX_PLACES,
        lang: 'ja',
        ...over,
      },
      system,
    );

  /** A Place `metres` north of the fixture point. */
  const north = (metres: number) => ({
    lat: FIXTURE_INSIDE.lat + metres / 111_320,
    lng: FIXTURE_INSIDE.lng,
  });

  it('answers the nearest live Places with their readiness, a missing row as false', async () => {
    const heard = await insertPlace(prisma, {
      areaId: tax.area.id,
      categoryId: tax.any.id,
      location: north(50),
    });
    await insertLocalization(prisma, heard.id, 'ja', heard.contentHash);
    const textOnly = await insertPlace(prisma, {
      areaId: tax.area.id,
      categoryId: tax.any.id,
      location: north(150),
    });
    await insertLocalization(prisma, textOnly.id, 'ja', textOnly.contentHash, { audioHash: null });
    const silent = await insertPlace(prisma, {
      areaId: tax.area.id,
      categoryId: tax.any.id,
      location: north(250),
    });

    const { candidates: found } = await candidates();
    expect(found).toEqual([
      { placeId: heard.id, contentHash: heard.contentHash, textReady: true, audioReady: true },
      {
        placeId: textOnly.id,
        contentHash: textOnly.contentHash,
        textReady: true,
        audioReady: false,
      },
      // No row for `ja` at all: answered, so the caller knows to warm it (api-endpoints-plan §12.2).
      { placeId: silent.id, contentHash: silent.contentHash, textReady: false, audioReady: false },
    ]);
  });

  it('counts a localization made from older text as not ready', async () => {
    const moved = await insertPlace(prisma, { areaId: tax.area.id, categoryId: tax.any.id });
    await insertLocalization(prisma, moved.id, 'ja', 'a'.repeat(64));
    const [only] = (await candidates()).candidates;
    expect(only).toMatchObject({ textReady: false, audioReady: false });

    // Text of the current version whose audio is a version behind is text-ready only (C-4).
    await prisma.placeLocalization.updateMany({
      where: { placeId: moved.id, lang: 'ja' },
      data: { sourceContentHash: moved.contentHash },
    });
    expect((await candidates()).candidates[0]).toMatchObject({
      textReady: true,
      audioReady: false,
    });
  });

  it('ignores boost, distance and the radius aside, and skips what a tourist cannot reach', async () => {
    const near = await insertPlace(prisma, {
      areaId: tax.area.id,
      categoryId: tax.any.id,
      location: north(100),
    });
    // Only a Venue may carry boost, and it makes no difference here.
    const boosted = await insertPlace(prisma, {
      areaId: tax.area.id,
      categoryId: tax.any.id,
      kind: PlaceKind.VENUE,
      location: north(400),
      discoveryBoost: 100,
    });
    await insertPlace(prisma, {
      areaId: tax.area.id,
      categoryId: tax.any.id,
      location: north(400),
      status: PlaceStatus.DRAFT,
    });
    await insertPlace(prisma, {
      areaId: tax.area.id,
      categoryId: tax.any.id,
      location: north(400),
      deleted: true,
    });
    await insertPlace(prisma, {
      areaId: tax.area.id,
      categoryId: tax.any.id,
      location: north(900),
    });

    // The boosted Place is further away, so it comes second: narration never sees boost (ADR 0007).
    const ordered = (await candidates({ radiusM: 500 })).candidates.map((row) => row.placeId);
    expect(ordered).toEqual([near.id, boosted.id]);
    expect((await candidates({ limit: 1 })).candidates.map((row) => row.placeId)).toEqual([
      near.id,
    ]);
  });

  it('refuses a radius or a size beyond the hotset bounds, and an unknown language', async () => {
    expect((await errorOf(candidates({ radiusM: HOTSET_RADIUS_M + 1 }))).code).toBe(
      'VALIDATION_FAILED',
    );
    expect((await errorOf(candidates({ limit: HOTSET_MAX_PLACES + 1 }))).code).toBe(
      'VALIDATION_FAILED',
    );
    expect((await errorOf(candidates({ lang: 'xx' }))).code).toBe('VALIDATION_FAILED');
  });
});
