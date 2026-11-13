// What the analytics dashboards read from catalog (rdm-spec C-15, api-endpoints-plan §7): QR scans
// per Place and day, or every Place summed per day; the nearest live Place to each point.
import { PlaceStatus } from '@wayfare/contracts';
import { FIXTURE_INSIDE } from '@wayfare/contracts/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { InsightsService } from '../../src/modules/insights/insights.service';
import { testPrisma, truncateAll } from '../setup/database';
import { errorOf, insertPlace, taxonomy } from '../setup/fixtures';

const prisma = testPrisma();
const insights = new InsightsService(prisma);
let tax: Awaited<ReturnType<typeof taxonomy>>;

beforeEach(async () => {
  await truncateAll(prisma);
  tax = await taxonomy(prisma);
});
afterAll(() => prisma.$disconnect());

const place = (fields: Partial<Parameters<typeof insertPlace>[1]> = {}) =>
  insertPlace(prisma, { areaId: tax.area.id, categoryId: tax.any.id, ...fields });

async function scans(placeId: string, day: string, count: number): Promise<void> {
  await prisma.placeQrScanDaily.create({
    data: { placeId, day: new Date(`${day}T00:00:00Z`), scans: count },
  });
}

describe('GetQrScans', () => {
  it('per Place and day for the Places named; every Place summed per day for none', async () => {
    const [a, b] = [await place(), await place()];
    await scans(a.id, '2026-11-01', 3);
    await scans(b.id, '2026-11-01', 2);
    await scans(a.id, '2026-11-03', 1);
    await scans(a.id, '2026-10-01', 9); // outside the range
    expect(
      await insights.getQrScans({ placeIds: [a.id], fromDay: '2026-11-01', toDay: '2026-11-03' }),
    ).toEqual({
      days: [
        { placeId: a.id, day: '2026-11-01', scans: 3 },
        { placeId: a.id, day: '2026-11-03', scans: 1 },
      ],
    });
    expect(
      await insights.getQrScans({ placeIds: [], fromDay: '2026-11-01', toDay: '2026-11-03' }),
    ).toEqual({
      days: [
        { placeId: '', day: '2026-11-01', scans: 5 },
        { placeId: '', day: '2026-11-03', scans: 1 },
      ],
    });
  });

  it('refuses a malformed or backwards range', async () => {
    const refused = await errorOf(
      insights.getQrScans({ placeIds: [], fromDay: '2026-11-03', toDay: '2026-11-01' }),
    );
    expect(refused.code).toBe('VALIDATION_FAILED');
  });
});

describe('NearestLivePlaces', () => {
  it('names the nearest live Place within the radius, for each point that has one', async () => {
    const near = { lat: FIXTURE_INSIDE.lat + 0.0005, lng: FIXTURE_INSIDE.lng };
    await place({ name: 'Gần', location: near });
    await place({ name: 'Bản nháp', location: FIXTURE_INSIDE, status: PlaceStatus.DRAFT });
    await place({ name: 'Đã xoá', location: FIXTURE_INSIDE, deleted: true });
    const far = { lat: FIXTURE_INSIDE.lat + 0.05, lng: FIXTURE_INSIDE.lng };
    const { places } = await insights.nearestLivePlaces({
      points: [FIXTURE_INSIDE, far],
      radiusM: 300,
    });
    expect(places).toEqual([{ index: 0, placeId: expect.any(String), nameVi: 'Gần' }]);
  });
});
