import { describe, expect, it, vi } from 'vitest';
import { inside, metres } from './corpus-geo';
import { SEED_EDITOR_CONTEXT } from './pilot-d1.seed';
import {
  districtOneRing,
  LOAD_PLACES,
  LOAD_SPACING_M,
  loadGrid,
  loadPlaceId,
  seedLoad,
} from './load.seed';

describe('the load seed’s grid', () => {
  const ring = districtOneRing();
  const points = loadGrid(ring, LOAD_PLACES, LOAD_SPACING_M);

  it('holds 2,000 points, every one inside the District 1 area', () => {
    expect(points).toHaveLength(2_000);
    expect(points.every((point) => inside(point, ring))).toBe(true);
    expect(new Set(points.map((point) => `${point.lat},${point.lng}`)).size).toBe(2_000);
  });

  it('puts each point about 40 m from its nearest neighbour', () => {
    // Nearest neighbours, for a sample: the grid is the same everywhere.
    for (const point of points.filter((_, index) => index % 97 === 0)) {
      const nearest = Math.min(
        ...points.filter((other) => other !== point).map((other) => metres(point, other)),
      );
      expect(nearest).toBeGreaterThan(38);
      expect(nearest).toBeLessThan(42);
    }
  });

  it('refuses an area too small for the count', () => {
    const tiny: [number, number][] = [
      [106.7, 10.77],
      [106.7004, 10.77],
      [106.7004, 10.7704],
      [106.7, 10.7704],
      [106.7, 10.77],
    ];
    expect(() => loadGrid(tiny, 10, LOAD_SPACING_M)).toThrow(/holds \d+ points/);
  });

  it('gives each Place a fixed UUIDv7-shaped id', () => {
    expect(loadPlaceId(1_999)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(loadPlaceId(0)).not.toBe(loadPlaceId(1));
  });
});

describe('the load seed in production', () => {
  it('refuses before making anything, with a small N', async () => {
    const places = { createEditorialPlace: vi.fn() };
    const prisma = { place: { findMany: vi.fn(), count: vi.fn() }, $executeRawUnsafe: vi.fn() };
    await expect(
      seedLoad(
        { NODE_ENV: 'production' },
        { places, prisma } as never,
        districtOneRing(),
        SEED_EDITOR_CONTEXT,
        3,
        () => undefined,
      ),
    ).rejects.toThrow(/NODE_ENV=production/);
    expect(places.createEditorialPlace).not.toHaveBeenCalled();
    expect(prisma.place.findMany).not.toHaveBeenCalled();
  });

  it('makes only the Places not made yet, then waits for them and analyses', async () => {
    const places = { createEditorialPlace: vi.fn().mockResolvedValue({}) };
    const prisma = {
      place: {
        findMany: vi.fn().mockResolvedValue([{ id: loadPlaceId(1) }]),
        count: vi.fn().mockResolvedValue(3),
      },
      $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    };
    const result = await seedLoad(
      { NODE_ENV: 'development' },
      { places, prisma } as never,
      districtOneRing(),
      SEED_EDITOR_CONTEXT,
      3,
      () => undefined,
    );
    expect(result).toEqual({ made: 2, kept: 1 });
    expect(places.createEditorialPlace).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      SEED_EDITOR_CONTEXT,
      {
        id: loadPlaceId(0),
      },
    );
    expect(places.createEditorialPlace).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      SEED_EDITOR_CONTEXT,
      {
        id: loadPlaceId(2),
      },
    );
    expect(places.createEditorialPlace.mock.calls[0]![0]).toMatchObject({
      requestActivation: true,
      content: { nameVi: expect.stringContaining('dữ liệu mẫu') },
    });
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith('ANALYZE places');
  });
});
