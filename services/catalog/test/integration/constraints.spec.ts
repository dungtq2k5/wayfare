// Each rdm-spec §5 catalog object refuses the row it exists to refuse (ADR 0045).
import { newId } from '@wayfare/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testPrisma, truncateAll } from '../setup/database';
import { insertLocalization, insertPlace, taxonomy } from '../setup/fixtures';

const prisma = testPrisma();
let placeId: string;
let hash: string;

beforeAll(async () => {
  await truncateAll(prisma);
  const { area, any } = await taxonomy(prisma);
  ({ id: placeId, contentHash: hash } = await insertPlace(prisma, {
    areaId: area.id,
    categoryId: any.id,
  }));
});
afterAll(() => prisma.$disconnect());

/** Runs a statement that must fail on `constraint`, in a transaction that is rolled back. */
async function refuses(constraint: string, sql: string): Promise<void> {
  const failure = await prisma
    .$transaction(async (tx) => {
      await tx.$executeRawUnsafe(sql);
      throw new Error('ROLLBACK: the statement was accepted');
    })
    .catch((error: unknown) => error);
  expect(String(failure instanceof Error ? failure.message : failure)).toContain(constraint);
}

/** A statement built once the fixture Place exists. */
type Sql = () => string;

const update =
  (set: string): Sql =>
  () =>
    `UPDATE places SET ${set} WHERE id = '${placeId}'`;

describe('catalog schema objects', () => {
  it.each([
    ['places_kind_owner_ck', update(`owner_user_id = '${newId()}'`)],
    ['places_kind_owner_ck', update(`kind = 'VENUE'`)],
    ['places_kind_owner_ck', update(`kind = 'LANDMARK'`)],
    ['places_editorial_narrates_ck', update('auto_narration_enabled = false')],
    ['places_editorial_no_boost_ck', update('discovery_boost = 10')],
    ['places_radius_ck', update('trigger_radius_m = 101')],
    ['places_radius_ck', update('trigger_radius_m = 9')],
    ['places_priority_ck', update('narration_priority = 101')],
    [
      'places_boost_ck',
      update(`kind = 'VENUE', owner_user_id = '${newId()}', discovery_boost = 101`),
    ],
    ['places_price_band_ck', update('price_band = 5')],
    ['places_inactive_reason_ck', update(`status = 'INACTIVE'`)],
    ['places_inactive_reason_ck', update(`inactive_reason = 'ADMIN'`)],
    ['places_menu_currency_ck', update(`menu_currency = 'EUR'`)],
    ['areas_default_zoom_ck', () => `UPDATE areas SET default_zoom = 9`],
    ['areas_default_zoom_ck', () => `UPDATE areas SET default_zoom = 19`],
  ] as [string, Sql][])('%s', async (constraint, sql) => {
    await refuses(constraint, sql());
  });

  it('place_localizations_audio_ready_ck refuses READY audio without a file', async () => {
    await insertLocalization(prisma, placeId, 'ja', hash, { audioHash: null });
    await refuses(
      'place_localizations_audio_ready_ck',
      `UPDATE place_localizations SET audio_status = 'READY' WHERE place_id = '${placeId}' AND lang = 'ja'`,
    );
    await insertLocalization(prisma, placeId, 'ko', hash);
    await refuses(
      'place_localizations_audio_ready_ck',
      `UPDATE place_localizations SET audio_status = 'FAILED' WHERE place_id = '${placeId}' AND lang = 'ko'`,
    );
  });

  it('menu_items_price_ck refuses a negative price', async () => {
    await refuses(
      'menu_items_price_ck',
      `INSERT INTO menu_items (id, place_id, name_vi, content_hash, price_minor, sort_order)
       VALUES ('${newId()}', '${placeId}', 'Phở', '${hash}', -1, 0)`,
    );
  });

  const hours =
    (columns: string, values: string): Sql =>
    () =>
      `INSERT INTO place_opening_hours (id, place_id, ${columns}) VALUES ('${newId()}', '${placeId}', ${values})`;

  it.each([
    ['place_opening_hours_one_of_ck', hours('is_closed', 'true')],
    [
      'place_opening_hours_one_of_ck',
      hours('weekday, specific_date, is_closed', `1, '2027-02-06', true`),
    ],
    ['place_opening_hours_times_ck', hours('weekday, opens_at', `1, '09:00'`)],
    ['place_opening_hours_weekday_ck', hours('weekday, is_closed', '8, true')],
  ] as [string, Sql][])('%s', async (constraint, sql) => {
    await refuses(constraint, sql());
  });

  /** A map pack row of the fixture area. */
  const pack = (version: number, status: string, minZoom = 10, maxZoom = 15) =>
    `INSERT INTO map_packs (id, area_id, version, status, pmtiles_object_path, pmtiles_sha256,
       pmtiles_bytes, style_object_path, assets, source, source_date, min_zoom, max_zoom,
       build_tool, created_by_id)
     SELECT '${newId()}', area_id, ${version}, '${status}', 'maps/a/b/map.pmtiles', '${'a'.repeat(64)}',
       1, 'maps/a/b/style.json', '{}', 'test', '2026-09-15', ${minZoom}, ${maxZoom}, 'test', '${newId()}'
     FROM places WHERE id = '${placeId}'`;

  it('map_packs_one_published refuses a second published pack in an area', async () => {
    await prisma.$executeRawUnsafe(pack(1, 'PUBLISHED'));
    await refuses('map_packs_one_published', pack(2, 'PUBLISHED'));
    await prisma.$executeRawUnsafe(pack(3, 'RETIRED'));
  });

  it('map_packs_zoom_ck refuses a zoom range that runs backwards', async () => {
    await refuses('map_packs_zoom_ck', pack(10, 'BUILDING', 15, 10));
  });

  it('keeps a public code unique, deleted Places included', async () => {
    const place = await prisma.place.update({
      where: { id: placeId },
      data: { deletedAt: new Date() },
      select: { publicCode: true, areaId: true, categoryId: true },
    });
    const failure = await insertPlace(prisma, { ...place, publicCode: place.publicCode }).catch(
      (error: unknown) => error,
    );
    expect(String(failure)).toMatch(/public_code|Unique constraint/);
    await prisma.place.update({ where: { id: placeId }, data: { deletedAt: null } });
  });
});
