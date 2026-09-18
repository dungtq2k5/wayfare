import { newId, PlaceKind, PlaceStatus } from '@wayfare/contracts';
import { catalogGrpc, localizationGrpc } from '@wayfare/contracts/grpc';
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
