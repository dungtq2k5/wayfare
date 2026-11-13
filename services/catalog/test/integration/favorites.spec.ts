// A device's saved Places (api-endpoints-plan §2.3, rdm-spec C-13): idempotent adds and removes,
// shared across a signed-in account's devices — at once for a favourite saved signed in — and the
// device and account events that move, delete and untie the rows.
import {
  IDENTITY_DEVICE_CLAIMED,
  IDENTITY_DEVICE_FORGOTTEN,
  newId,
  PlaceStatus,
} from '@wayfare/contracts';
import type { RequestContext } from '@wayfare/nest-common';
import { buildAccountContext, buildDeviceContext } from '@wayfare/nest-common/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testPrisma, truncateAll } from '../setup/database';
import { errorOf, insertLocalization, insertPlace, taxonomy } from '../setup/fixtures';
import { catalogServices } from '../setup/services';

const prisma = testPrisma();
let services: ReturnType<typeof catalogServices>;
let tax: Awaited<ReturnType<typeof taxonomy>>;
const CONSUMER = 'catalog-test-favorites';

beforeEach(async () => {
  await truncateAll(prisma);
  services = catalogServices(prisma);
  tax = await taxonomy(prisma);
});
afterAll(() => prisma.$disconnect());

async function place(name: string, status = PlaceStatus.ACTIVE) {
  const row = await insertPlace(prisma, {
    areaId: tax.area.id,
    categoryId: tax.any.id,
    name,
    status,
  });
  await insertLocalization(prisma, row.id, 'en', row.contentHash, { name: `${name} (en)` });
  return row.id;
}

const add = (placeId: string, as: RequestContext) =>
  services.favorites.addFavorite({ placeId }, as);
const remove = (placeId: string, as: RequestContext) =>
  services.favorites.removeFavorite({ placeId }, as);
const list = async (as: RequestContext, cursor?: string, limit = 20) =>
  services.favorites.listFavorites({ page: { cursor, limit }, lang: 'en' }, as);
const ids = async (as: RequestContext) => (await list(as)).favorites.map((row) => row.placeId);

const claimed = (deviceId: string, userId: string) =>
  services.favorites.claimDevice(
    IDENTITY_DEVICE_CLAIMED.schema.parse({
      eventId: newId(),
      occurredAt: new Date().toISOString(),
      deviceId,
      userId,
    }),
    CONSUMER,
  );

describe('favourites', () => {
  it('adds idempotently, lists newest first in the language asked, and pages with a cursor', async () => {
    const phone = buildDeviceContext();
    const [a, b, c] = [await place('Chợ A'), await place('Chợ B'), await place('Chợ C')];
    await add(a, phone);
    await add(a, phone);
    await add(b, phone);
    await add(c, phone);
    expect(await prisma.favorite.count()).toBe(3);

    const first = await list(phone, undefined, 2);
    expect(first.favorites.map((row) => row.placeId)).toEqual([c, b]);
    expect(first.favorites[0]!.place).toMatchObject({ id: c, name: 'Chợ C (en)', lang: 'en' });
    const second = await list(phone, first.page!.nextCursor, 2);
    expect(second.favorites.map((row) => row.placeId)).toEqual([a]);
    expect(second.page!.nextCursor).toBeUndefined();

    // Only live Places are listed; a restored one comes back.
    await prisma.place.update({ where: { id: b }, data: { deletedAt: new Date() } });
    expect(await ids(phone)).toEqual([c, a]);
    await prisma.place.update({ where: { id: b }, data: { deletedAt: null } });
    expect(await ids(phone)).toEqual([c, b, a]);

    const draft = await place('Nháp', PlaceStatus.DRAFT);
    expect(await errorOf(add(draft, phone))).toEqual({
      code: 'RESOURCE_NOT_FOUND',
      details: { resource: 'PLACE' },
    });
    expect((await errorOf(list(phone, 'not-a-cursor'))).code).toBe('VALIDATION_FAILED');
  });

  it('shares across a signed-in account’s devices, a new favourite at once, and removes from all', async () => {
    const userId = newId();
    const phoneId = newId();
    const tabletId = newId();
    const [a, b, c] = [await place('Chợ A'), await place('Chợ B'), await place('Chợ C')];

    // Saved anonymously on the phone, then the phone is claimed.
    await add(a, buildDeviceContext({ deviceId: phoneId }));
    await add(b, buildDeviceContext({ deviceId: phoneId }));
    await claimed(phoneId, userId);
    const phone = buildAccountContext({ userId, deviceId: phoneId });
    const tablet = buildAccountContext({ userId, deviceId: tabletId });
    expect(await ids(tablet)).toEqual([b, a]);

    // Saved on the tablet after the claim: the phone sees it with no event.
    await add(c, tablet);
    expect(await ids(phone)).toEqual([c, b, a]);
    // An anonymous device sees only its own.
    expect(await ids(buildDeviceContext({ deviceId: tabletId }))).toEqual([c]);

    await remove(a, tablet);
    expect(await ids(phone)).toEqual([c, b]);
    await remove(a, tablet);
    expect(await prisma.favorite.count({ where: { placeId: a } })).toBe(0);
  });

  it('follows the device and account events, each once', async () => {
    const userId = newId();
    const phoneId = newId();
    const [a, b] = [await place('Chợ A'), await place('Chợ B')];
    await add(a, buildDeviceContext({ deviceId: phoneId }));
    const event = IDENTITY_DEVICE_CLAIMED.schema.parse({
      eventId: newId(),
      occurredAt: new Date().toISOString(),
      deviceId: phoneId,
      userId,
    });
    await services.favorites.claimDevice(event, CONSUMER);
    expect((await prisma.favorite.findFirstOrThrow()).userId).toBe(userId);

    // The account is erased: the rows stay with the device, tied to no one; a redelivered claim
    // does not tie them again.
    await services.favorites.eraseUser({
      eventId: newId(),
      occurredAt: new Date().toISOString(),
      userId,
    });
    await services.favorites.claimDevice(event, CONSUMER);
    expect(await prisma.favorite.findMany({ select: { userId: true } })).toEqual([
      { userId: null },
    ]);

    await add(b, buildDeviceContext({ deviceId: phoneId }));
    await services.favorites.forgetDevice(
      IDENTITY_DEVICE_FORGOTTEN.schema.parse({
        eventId: newId(),
        occurredAt: new Date().toISOString(),
        deviceId: phoneId,
      }),
      CONSUMER,
    );
    expect(await prisma.favorite.count()).toBe(0);
  });
});
