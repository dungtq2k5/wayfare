// The Vĩnh Khánh seed through catalog's submission and review path (ADR 0002), on a three-Venue
// slice of the corpus: one owner per plan, and the two items left in the review queue.
import {
  BILLING_ENTITLEMENTS_CHANGED,
  FREE_PLAN_GRANTS,
  newId,
  PlaceStatus,
  SubmissionKind,
  SubmissionStatus,
} from '@wayfare/contracts';
import type { Entitlements } from '@wayfare/contracts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SEED_EDITOR_CONTEXT } from '../../prisma/seed/pilot-d1.seed';
import { loadPilotD4, seedPilotD4, waitForGrants } from '../../prisma/seed/pilot-d4.seed';
import type { PilotD4Corpus, PilotD4Deps } from '../../prisma/seed/pilot-d4.seed';
import { AreasService } from '../../src/modules/areas/areas.service';
import { testPrisma, truncateAll } from '../setup/database';
import { catalogServices, GROWTH_GRANTS } from '../setup/services';

const prisma = testPrisma();
const services = catalogServices(prisma);
const full = loadPilotD4();
const slice: PilotD4Corpus = {
  ...full,
  venues: full.venues.filter((venue) => ['oc-mau-a', 'oc-mau-e', 'com-mau-l'].includes(venue.slug)),
};
const ownerOf = (slug: string) => full.owners.get(slug)!;
const GRANTS: Record<string, Entitlements> = {
  'owner-1': GROWTH_GRANTS,
  'owner-2': GROWTH_GRANTS,
  'owner-4': FREE_PLAN_GRANTS,
};

/** billing's current versions, as `GetEntitlements` answers them. */
const versions = new Map<string, number>();
const deps: PilotD4Deps = {
  prisma,
  areas: new AreasService(prisma),
  places: services.places,
  submissions: services.submissions,
  review: services.review,
  billing: { getEntitlementsVersion: (id) => Promise.resolve(versions.get(id) ?? 0) },
  ownerEntitlements: services.ownerEntitlements,
};
const fast = { timeoutMs: 200, intervalMs: 50 };

/** The grants billing publishes, as catalog's consumer records them. */
async function granted(): Promise<void> {
  for (const [slug, entitlements] of Object.entries(GRANTS)) {
    const ownerUserId = ownerOf(slug);
    versions.set(ownerUserId, 1);
    services.billing.grants.set(ownerUserId, entitlements);
    await services.ownerEntitlements.record(
      prisma,
      BILLING_ENTITLEMENTS_CHANGED.schema.parse({
        eventId: newId(),
        occurredAt: new Date().toISOString(),
        ownerUserId,
        entitlementsVersion: 1,
        entitlements,
        previous: null,
      }),
    );
  }
}

beforeEach(async () => {
  await truncateAll(prisma);
  versions.clear();
});
afterAll(async () => {
  await truncateAll(prisma);
  await prisma.$disconnect();
});

describe('the Vĩnh Khánh seed', () => {
  it('creates each Venue through a submission and its approval; a second run writes nothing', async () => {
    await granted();
    const first = await seedPilotD4(deps, slice, SEED_EDITOR_CONTEXT, fast);
    expect(first.area).toBe(`${slice.area.code}: created`);
    expect(first.rows.map((row) => `${row.outcome} ${row.slug}`)).toEqual([
      'created oc-mau-a',
      'created oc-mau-e',
      'created com-mau-l',
      'submitted nuong-mau-d (pending creation)',
      'submitted oc-mau-e (pending edit)',
    ]);

    for (const venue of slice.venues) {
      const place = await prisma.place.findUniqueOrThrow({
        where: { id: venue.id },
        select: {
          publicCode: true,
          status: true,
          ownerUserId: true,
          triggerRadiusM: true,
          narrationPriority: true,
          autoNarrationEnabled: true,
        },
      });
      expect(place, venue.slug).toMatchObject({
        publicCode: venue.publicCode,
        // Narration runs in its own service; until it answers, a created Venue is processing.
        status: PlaceStatus.PROCESSING,
        ownerUserId: ownerOf(venue.ownerSlug),
        triggerRadiusM: venue.triggerRadiusM,
        narrationPriority: venue.narrationPriority,
        // Auto-narration follows the owner's plan: on for Growth, off for Free.
        autoNarrationEnabled: venue.ownerSlug !== 'owner-4',
      });
    }
    const queue = await prisma.placeSubmission.findMany({
      where: { status: SubmissionStatus.PENDING },
      select: { id: true, kind: true, placeId: true },
      orderBy: { id: 'asc' },
    });
    expect(queue).toEqual(
      expect.arrayContaining([
        { id: slice.pending.create.submissionId, kind: SubmissionKind.CREATE, placeId: null },
        {
          id: slice.pending.update.submissionId,
          kind: SubmissionKind.UPDATE,
          placeId: slice.venues.find((venue) => venue.slug === 'oc-mau-e')!.id,
        },
      ]),
    );
    expect(queue).toHaveLength(2);

    const outbox = await prisma.outboxEvent.count();
    const submissions = await prisma.placeSubmission.count();
    const second = await seedPilotD4(deps, slice, SEED_EDITOR_CONTEXT, fast);
    expect(second.area).toBe(`${slice.area.code}: unchanged`);
    expect(second.rows.map((row) => `${row.outcome} ${row.slug}`)).toEqual([
      'unchanged oc-mau-a',
      // Its pending edit is the queue's, and is never replaced.
      'skipped oc-mau-e',
      'unchanged com-mau-l',
      'unchanged nuong-mau-d (pending creation)',
      'unchanged oc-mau-e (pending edit)',
    ]);
    expect(await prisma.outboxEvent.count()).toBe(outbox);
    expect(await prisma.placeSubmission.count()).toBe(submissions);
  });

  it('brings a changed Venue back to the corpus through an approved UPDATE', async () => {
    await granted();
    await seedPilotD4(deps, slice, SEED_EDITOR_CONTEXT, fast);
    const venue = slice.venues[0]!;
    await prisma.place.update({ where: { id: venue.id }, data: { triggerRadiusM: 99 } });
    const report = await seedPilotD4(deps, slice, SEED_EDITOR_CONTEXT, fast);
    expect(report.rows[0]).toEqual({ slug: venue.slug, outcome: 'updated', detail: 'editorial' });
    expect((await prisma.place.findUniqueOrThrow({ where: { id: venue.id } })).triggerRadiusM).toBe(
      venue.triggerRadiusM,
    );
    expect(
      await prisma.placeSubmission.count({
        where: {
          placeId: venue.id,
          kind: SubmissionKind.UPDATE,
          status: SubmissionStatus.APPROVED,
        },
      }),
    ).toBe(1);
  });

  it('says whose grants catalog is still missing, before creating any Venue', async () => {
    await granted();
    // billing has moved on to a version catalog's consumer never recorded.
    versions.set(ownerOf('owner-2'), 2);
    await expect(
      waitForGrants(deps, [ownerOf('owner-1'), ownerOf('owner-2')], fast),
    ).rejects.toThrow(
      new RegExp(`still behind for ${ownerOf('owner-2')}\\. Are billing and catalog running`),
    );
    await expect(seedPilotD4(deps, slice, SEED_EDITOR_CONTEXT, fast)).rejects.toThrow(
      /still behind/,
    );
    expect(await prisma.place.count()).toBe(0);
  });
});
