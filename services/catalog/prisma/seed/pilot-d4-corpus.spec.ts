// The committed Vĩnh Khánh corpus is valid, and obviously not real, before it is ever seeded
// (ADR 0001, ADR 0002): the three services' files agree, every Venue sits inside the area and apart
// from its neighbours, every owner fits their plan, and nothing could be mistaken for a real record.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CategoryAppliesTo,
  effectiveLimit,
  FREE_PLAN_GRANTS,
  MenuCurrency,
  SYSTEM_CATEGORIES,
} from '@wayfare/contracts';
import { packageRoot } from '@wayfare/nest-common';
import { describe, expect, it } from 'vitest';
import { inside, metres, toSegment } from './corpus-geo';
import { loadPilotD4, SAMPLE_MARK } from './pilot-d4.seed';

const REPO_ROOT = resolve(packageRoot(__dirname), '../..');
const read = (path: string): unknown => JSON.parse(readFileSync(resolve(REPO_ROOT, path), 'utf8'));

const corpus = loadPilotD4();
const { owners } = read('services/identity/prisma/seed/pilot-d4/owners.json') as {
  owners: {
    slug: string;
    id: string;
    email: string;
    fullName: string;
    registration: { id: string; nationalId: string; businessName: string; status: string };
  }[];
};
const { plans } = read('services/billing/prisma/seed/pilot-d4/plans.json') as {
  plans: { ownerSlug: string; ownerUserId: string; planCode: string }[];
};
const allVenues = [...corpus.venues, corpus.pending.create];
const unique = (values: readonly string[]) => new Set(values).size === values.length;

/** The seeded plans' place limits: FREE from the contracts, the paid ones as billing's dev seed. */
const MAX_PLACES: Record<string, number> = {
  FREE: effectiveLimit('maxPlaces', FREE_PLAN_GRANTS),
  GROWTH: 10,
  PRO: 50,
};

describe('the Vĩnh Khánh corpus', () => {
  it('parses, with unique slugs, ids, codes and submission ids', () => {
    expect(corpus.venues).toHaveLength(10);
    expect(unique(allVenues.map((venue) => venue.slug))).toBe(true);
    expect(unique(allVenues.map((venue) => venue.id))).toBe(true);
    expect(unique(allVenues.map((venue) => venue.publicCode))).toBe(true);
    expect(
      unique([...allVenues.map((venue) => venue.submissionId), corpus.pending.update.submissionId]),
    ).toBe(true);
    expect(corpus.venues.some((venue) => venue.slug === corpus.pending.update.venueSlug)).toBe(
      true,
    );
  });

  it('agrees across the three services on who the owners are', () => {
    const ids = new Map(owners.map((owner) => [owner.slug, owner.id]));
    for (const plan of plans)
      expect(ids.get(plan.ownerSlug), plan.ownerSlug).toBe(plan.ownerUserId);
    for (const venue of allVenues) expect(ids.has(venue.ownerSlug), venue.slug).toBe(true);
    expect(corpus.owners).toEqual(ids);
    expect(unique(owners.map((owner) => owner.id))).toBe(true);
    expect(unique(owners.map((owner) => owner.registration.id))).toBe(true);
  });

  it('puts every Venue inside the area, 20 m from its edge and from each other', () => {
    const ring = corpus.area.boundary.coordinates[0];
    expect(inside(corpus.area.center, ring)).toBe(true);
    for (const venue of allVenues) {
      expect(inside(venue.location, ring), venue.slug).toBe(true);
      const edge = Math.min(
        ...ring.slice(1).map((corner, index) => toSegment(venue.location, ring[index]!, corner)),
      );
      expect(edge, venue.slug).toBeGreaterThanOrEqual(20);
    }
    for (const [index, a] of allVenues.entries()) {
      for (const b of allVenues.slice(index + 1)) {
        expect(metres(a.location, b.location), `${a.slug} ↔ ${b.slug}`).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it('uses Venue categories only, and fits each owner within their plan, pending creation included', () => {
    const venueCategories = new Set(
      SYSTEM_CATEGORIES.filter((category) => category.appliesTo === CategoryAppliesTo.VENUE).map(
        (category) => category.code,
      ),
    );
    for (const venue of allVenues) {
      expect(venueCategories.has(venue.categoryCode), venue.slug).toBe(true);
    }
    for (const plan of plans) {
      const count = allVenues.filter((venue) => venue.ownerSlug === plan.ownerSlug).length;
      expect(count, plan.ownerSlug).toBeLessThanOrEqual(MAX_PLACES[plan.planCode]!);
    }
  });

  it('can never be mistaken for a real record', () => {
    for (const owner of owners) {
      expect(owner.email, owner.slug).toMatch(/@wayfare\.test$/);
      expect(owner.registration.nationalId, owner.slug).toMatch(/^000\d{9}$/);
      expect(owner.registration.businessName, owner.slug).toContain(SAMPLE_MARK);
      expect(owner.fullName, owner.slug).toMatch(/Mẫu/);
    }
    for (const venue of allVenues) {
      expect(venue.nameVi, venue.slug).toContain(SAMPLE_MARK);
      expect(venue.descriptionVi, venue.slug).toMatch(/quán mẫu/i);
    }
    expect(owners.filter((owner) => owner.registration.status === 'PENDING')).toHaveLength(1);
  });

  it('shows what the seed is for: a USD menu, an unavailable item, a night past midnight, a closed day', () => {
    expect(allVenues.some((venue) => venue.menu.menuCurrency === MenuCurrency.USD)).toBe(true);
    expect(allVenues.some((venue) => venue.menu.items.some((item) => !item.isAvailable))).toBe(
      true,
    );
    expect(
      allVenues.some((venue) =>
        venue.openingHours.some(
          (row) => !row.isClosed && row.closesAt !== undefined && row.closesAt < row.opensAt!,
        ),
      ),
    ).toBe(true);
    expect(allVenues.some((venue) => venue.openingHours.some((row) => row.isClosed))).toBe(true);
    for (const venue of allVenues) {
      expect(venue.descriptionVi.length, venue.slug).toBeGreaterThanOrEqual(200);
      expect(venue.descriptionVi.length, venue.slug).toBeLessThanOrEqual(400);
    }
  });
});
