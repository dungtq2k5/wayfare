// Delta sync stays exact across concurrent writes (rdm-spec §1.7): clients that sync repeatedly
// while Places are created, edited, activated, deleted and moved between areas end with exactly
// the live set of their area, and no answer ever goes backwards.
import { compareStrings, NARRATION_LOCALIZATION_READY } from '@wayfare/contracts';
import { localizationReadyFixture } from '@wayfare/contracts/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertArea, testPrisma, truncateAll } from '../setup/database';
import { contentInput, createRequest, device, staff, updateRequest } from '../setup/fixtures';
import { catalogServices } from '../setup/services';

const prisma = testPrisma();
const { places, queries, localizations } = catalogServices(prisma);
const WRITE_FOR_MS = 8_000;
const actor = staff();

const EAST_RING = [
  [106.72, 10.765],
  [106.74, 10.765],
  [106.74, 10.78],
  [106.72, 10.78],
  [106.72, 10.765],
] as const;
const WEST_POINT = { lat: 10.7725, lng: 106.698 };
const EAST_POINT = { lat: 10.7725, lng: 106.73 };

/** A small deterministic generator: the soak is repeatable. */
function generator(seed: number) {
  let state = seed;
  return (below: number) => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state % below;
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let areas: { west: string; east: string };

beforeAll(async () => {
  await truncateAll(prisma);
  const west = await insertArea(prisma, { code: 'west' });
  const east = await insertArea(prisma, { code: 'east', ring: EAST_RING });
  areas = { west: west.id, east: east.id };
});
afterAll(() => prisma.$disconnect());

async function openGate(placeId: string): Promise<void> {
  const place = await prisma.place.findUniqueOrThrow({ where: { id: placeId } });
  await localizations.applyReady(
    NARRATION_LOCALIZATION_READY.schema.parse(
      localizationReadyFixture({ placeId, lang: 'en', sourceContentHash: place.contentHash }),
    ),
    'soak',
  );
}

async function writer(seed: number, until: number, created: string[]): Promise<void> {
  const next = generator(seed);
  let edits = 0;
  while (Date.now() < until) {
    const target = created[next(Math.max(created.length, 1))];
    const choice = target === undefined ? 0 : next(7);
    try {
      switch (choice) {
        case 0: {
          const location = next(2) === 0 ? WEST_POINT : EAST_POINT;
          const { place } = await places.createEditorialPlace(
            createRequest({ content: contentInput({ location }), requestActivation: true }),
            actor,
          );
          created.push(place!.id);
          await openGate(place!.id);
          break;
        }
        case 1:
          edits += 1;
          await places.updatePlace(
            updateRequest(target!, { descriptionVi: `Mô tả ${seed}-${edits}` }),
            actor,
          );
          break;
        case 2:
          await openGate(target!);
          break;
        case 3:
          await places.updatePlace(
            updateRequest(target!, { location: next(2) === 0 ? WEST_POINT : EAST_POINT }),
            actor,
          );
          break;
        case 4:
          await places.deletePlace({ placeId: target! }, actor);
          break;
        case 5:
          await places.restorePlace({ placeId: target! }, actor);
          break;
        default:
          await places.updateEditorial({ placeId: target!, triggerRadiusM: 10 + next(90) }, actor);
      }
    } catch {
      // Refused transitions (deleting a deleted Place…) are part of the noise.
    }
    await sleep(next(40));
  }
}

/** A phone: what it holds, and every version it was told. */
class Client {
  readonly held = new Set<string>();
  version = '0';
  wentBackwards = false;

  constructor(private readonly areaId: string) {}

  async sync(): Promise<void> {
    for (;;) {
      const answer = await queries.syncPlaces(
        { areaId: this.areaId, lang: 'en', since: this.version },
        device(),
      );
      for (const place of answer.places) this.held.add(place.id);
      for (const id of answer.removedPlaceIds) this.held.delete(id);
      if (BigInt(answer.datasetVersion) < BigInt(this.version)) this.wentBackwards = true;
      this.version = answer.datasetVersion;
      if (answer.complete) return;
    }
  }
}

async function liveIn(areaId: string): Promise<Set<string>> {
  const rows = await prisma.place.findMany({
    where: { areaId, status: 'ACTIVE', deletedAt: null },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

describe('delta sync under concurrent writes', () => {
  it('ends with exactly the live set of each area', async () => {
    const until = Date.now() + WRITE_FOR_MS;
    const created: string[] = [];
    const clients = [new Client(areas.west), new Client(areas.east)];
    let syncing = true;
    const readers = clients.map(async (client) => {
      while (syncing) {
        await client.sync();
        await sleep(250);
      }
    });
    await Promise.all([1, 2, 3].map((seed) => writer(seed, until, created)));
    // Past the lag, everything written is settled.
    await sleep(6_000);
    syncing = false;
    await Promise.all(readers);
    for (const client of clients) await client.sync();

    expect(created.length).toBeGreaterThan(5);
    const [west, east] = clients;
    expect(west!.wentBackwards || east!.wentBackwards).toBe(false);
    expect([...west!.held].toSorted(compareStrings)).toEqual(
      [...(await liveIn(areas.west))].toSorted(compareStrings),
    );
    expect([...east!.held].toSorted(compareStrings)).toEqual(
      [...(await liveIn(areas.east))].toSorted(compareStrings),
    );
    expect(west!.held.size + east!.held.size).toBeGreaterThan(0);
  }, 60_000);
});
