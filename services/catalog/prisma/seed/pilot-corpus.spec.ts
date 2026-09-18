// The committed pilot corpus is valid before it is ever seeded (ADR 0002, D5).
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CategoryAppliesTo, SYSTEM_CATEGORIES } from '@wayfare/contracts';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { loadPilotCorpus } from './pilot-corpus';
import type { PilotPlace } from './pilot-corpus';

const corpus = loadPilotCorpus();
const EARTH_M = 6_371_000;
const rad = (degrees: number) => (degrees * Math.PI) / 180;

/** Metres between two points, equirectangular — exact enough at a district's scale. */
function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const x = rad(b.lng - a.lng) * Math.cos(rad((a.lat + b.lat) / 2));
  return Math.hypot(x, rad(b.lat - a.lat)) * EARTH_M;
}

/** Metres from a point to a segment, in a local flat frame. */
function toSegment(
  p: { lat: number; lng: number },
  a: [number, number],
  b: [number, number],
): number {
  const k = Math.cos(rad(p.lat)) * EARTH_M;
  const [px, py] = [rad(p.lng) * k, rad(p.lat) * EARTH_M];
  const [ax, ay] = [rad(a[0]) * k, rad(a[1]) * EARTH_M];
  const [bx, by] = [rad(b[0]) * k, rad(b[1]) * EARTH_M];
  const t = Math.max(
    0,
    Math.min(
      1,
      ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2),
    ),
  );
  return Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
}

/** Ray casting over `[lng, lat]` corners. */
function inside(p: { lat: number; lng: number }, ring: readonly [number, number][]): boolean {
  let within = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi)
      within = !within;
  }
  return within;
}

const unique = (values: readonly string[]) => new Set(values).size === values.length;

describe('the District 1 pilot corpus', () => {
  it('parses, with 15 to 20 Places whose slugs, ids and codes are unique', () => {
    expect(corpus.places.length).toBeGreaterThanOrEqual(15);
    expect(corpus.places.length).toBeLessThanOrEqual(20);
    expect(unique(corpus.places.map((place) => place.slug))).toBe(true);
    expect(unique(corpus.places.map((place) => place.id))).toBe(true);
    expect(unique(corpus.places.map((place) => place.publicCode))).toBe(true);
    expect(corpus.places.map((place) => place.id)).not.toContain(corpus.area.id);
  });

  it('uses registry categories an Editorial Place may take', () => {
    for (const place of corpus.places) {
      const category = SYSTEM_CATEGORIES.find((entry) => entry.code === place.categoryCode);
      expect(category, place.slug).toBeDefined();
      expect([CategoryAppliesTo.EDITORIAL, CategoryAppliesTo.ANY], place.slug).toContain(
        category!.appliesTo,
      );
    }
  });

  it('keeps descriptions between 600 and 900 characters', () => {
    for (const place of corpus.places) {
      expect(place.descriptionVi.length, place.slug).toBeGreaterThanOrEqual(600);
      expect(place.descriptionVi.length, place.slug).toBeLessThanOrEqual(900);
    }
  });

  it('places every Place inside the area, at least 50 m from its edge', () => {
    const ring = corpus.area.boundary.coordinates[0]!;
    expect(inside(corpus.area.center, ring)).toBe(true);
    for (const place of corpus.places) {
      expect(inside(place.location, ring), place.slug).toBe(true);
      const edge = Math.min(
        ...ring.slice(1).map((corner, index) => toSegment(place.location, ring[index]!, corner)),
      );
      expect(edge, place.slug).toBeGreaterThanOrEqual(50);
    }
  });

  it('keeps Places 20 m apart, and overlapping circles on distinct priorities', () => {
    const places: readonly PilotPlace[] = corpus.places;
    for (const [index, a] of places.entries()) {
      for (const b of places.slice(index + 1)) {
        const apart = metres(a.location, b.location);
        expect(apart, `${a.slug} · ${b.slug}`).toBeGreaterThanOrEqual(20);
        if (apart < a.triggerRadiusM + b.triggerRadiusM) {
          expect(a.narrationPriority, `${a.slug} · ${b.slug} overlap`).not.toBe(
            b.narrationPriority,
          );
        }
      }
    }
  });

  it('commits only small, stripped photos, and lists every one it commits', async () => {
    const listed = new Set(
      corpus.places.flatMap((place) => place.photos.map((photo) => photo.file)),
    );
    for (const file of listed) {
      const path = join(corpus.photosDir, file);
      expect(existsSync(path), file).toBe(true);
      expect(statSync(path).size, file).toBeLessThanOrEqual(400 * 1024);
      const meta = await sharp(path).metadata();
      expect(['jpeg', 'webp'], file).toContain(meta.format);
      expect(Math.max(meta.width, meta.height), file).toBeLessThanOrEqual(1600);
      expect(meta.exif, `${file} carries EXIF`).toBeUndefined();
    }
    const committed = readdirSync(corpus.photosDir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name !== '.gitkeep')
      .map((entry) => `${entry.parentPath.slice(corpus.photosDir.length + 1)}/${entry.name}`);
    for (const file of committed)
      expect(listed.has(file), `${file} is not in places.json`).toBe(true);
  });

  // The phase 1 demo gate: PILOT_REQUIRE_REVIEWED=1 pnpm test.
  it.runIf(process.env.PILOT_REQUIRE_REVIEWED === '1')(
    'is fully reviewed, every location checked',
    () => {
      for (const place of corpus.places) {
        expect(place.review, place.slug).toBe('REVIEWED');
        expect(place.locationSource, place.slug).toBe('OSM');
      }
    },
  );
});
