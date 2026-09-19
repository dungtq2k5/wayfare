// pnpm seed:dev — the Vĩnh Khánh pilot (ADR 0001, ADR 0002): its area, and the seeded owners'
// Venues created exactly as a real owner's are — a submission from the owner, approved by the seed
// editor with the corpus's editorial values — plus one pending creation and one pending edit left
// in the review queue. Run it through turbo only, after identity's and billing's seeds: it waits
// for each owner's grants to reach catalog. Never in production; idempotent; never deletes.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import {
  MAX_TRIGGER_RADIUS_M,
  MIN_TRIGGER_RADIUS_M,
  NARRATION_PRIORITY_MAX,
  NARRATION_PRIORITY_MIN,
  SubmissionKind,
  SubmissionStatus,
  zPlaceSubmissionPayload,
  zPublicCode,
  zUuidV7,
} from '@wayfare/contracts';
import type { PlaceSubmissionPayload } from '@wayfare/contracts';
import { submissionKindProto } from '@wayfare/contracts/grpc';
import { packageRoot, SYSTEM_ORIGIN } from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import { config } from 'dotenv';
import { z } from 'zod';
import { AppModule } from '../../src/app.module';
import { AreasService, isAreaRefusal } from '../../src/modules/areas/areas.service';
import { BillingPortService } from '../../src/modules/billing-port/billing-port.service';
import { OwnerEntitlementsService } from '../../src/modules/owner-entitlements/owner-entitlements.service';
import { editableHash } from '../../src/modules/places/domain/editable-hash';
import {
  changedFields,
  snapshotOfPayload,
  snapshotOfPlace,
} from '../../src/modules/places/domain/submission-diff';
import { PlacesService } from '../../src/modules/places/places.service';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { SubmissionReviewService } from '../../src/modules/submission-review/submission-review.service';
import { SubmissionsService } from '../../src/modules/submissions/submissions.service';
import { zPilotArea } from './pilot-corpus';
import type { PilotArea } from './pilot-corpus';
import { assertNotProduction, SEED_EDITOR_CONTEXT } from './pilot-d1.seed';

const REPO_ROOT = resolve(packageRoot(__dirname), '../..');

/** The committed Vĩnh Khánh folder. */
export const PILOT_D4_DIR = resolve(packageRoot(__dirname), 'prisma/seed/pilot-d4');

/** Marks every seeded Venue as a sample (ADR 0002): never mistaken for a real one. */
export const SAMPLE_MARK = 'dữ liệu mẫu';

const { photos: _photos, ...payloadFields } = zPlaceSubmissionPayload.shape;

/** One committed Venue: an owner's desired state, its committed identity and the editorial values. */
export const zPilotVenue = z
  .object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    id: zUuidV7,
    publicCode: zPublicCode,
    submissionId: zUuidV7,
    ownerSlug: z.string().regex(/^owner-\d+$/),
    review: z.literal('SAMPLE'),
    triggerRadiusM: z.number().int().min(MIN_TRIGGER_RADIUS_M).max(MAX_TRIGGER_RADIUS_M),
    narrationPriority: z.number().int().min(NARRATION_PRIORITY_MIN).max(NARRATION_PRIORITY_MAX),
    // The payload's own fields and rules; no photos are committed.
    ...payloadFields,
  })
  .strict()
  .refine((venue) => venue.nameVi.includes(SAMPLE_MARK), { message: 'Not marked as a sample' });
/** One committed Venue. */
export type PilotVenue = z.output<typeof zPilotVenue>;

/** The Venues, and the two items left in the review queue. */
export const zPilotVenues = z
  .object({
    venues: z.array(zPilotVenue).min(1),
    pending: z
      .object({
        create: zPilotVenue,
        update: z
          .object({
            venueSlug: z.string(),
            submissionId: zUuidV7,
            descriptionVi: z.string().min(1),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

/** A loaded Vĩnh Khánh corpus, with the owner ids from identity's committed owners. */
export interface PilotD4Corpus {
  readonly area: PilotArea;
  readonly venues: readonly PilotVenue[];
  readonly pending: z.output<typeof zPilotVenues>['pending'];
  readonly owners: ReadonlyMap<string, string>;
}

/** Reads and validates the corpus; throws naming the first bad entry. */
export function loadPilotD4(
  dir: string = PILOT_D4_DIR,
  ownersFile: string = resolve(REPO_ROOT, 'services/identity/prisma/seed/pilot-d4/owners.json'),
): PilotD4Corpus {
  const read = (file: string): unknown => JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const area = zPilotArea.parse(read('area.json'));
  const { venues, pending } = zPilotVenues.parse(read('venues.json'));
  const owners = new Map(
    (
      JSON.parse(readFileSync(ownersFile, 'utf8')) as { owners: { slug: string; id: string }[] }
    ).owners.map((owner) => [owner.slug, owner.id]),
  );
  for (const venue of [...venues, pending.create]) {
    if (!owners.has(venue.ownerSlug)) throw new Error(`venues.json: no owner ${venue.ownerSlug}`);
  }
  return { area, venues, pending, owners };
}

/** A Venue's payload: its desired state, with no photos (none are committed). */
export function payloadOf(venue: PilotVenue, descriptionVi?: string): PlaceSubmissionPayload {
  return zPlaceSubmissionPayload.parse({
    nameVi: venue.nameVi,
    descriptionVi: descriptionVi ?? venue.descriptionVi,
    categoryCode: venue.categoryCode,
    location: venue.location,
    addressVi: venue.addressVi,
    priceBand: venue.priceBand,
    phone: venue.phone,
    websiteUrl: venue.websiteUrl,
    openingHours: venue.openingHours,
    photos: [],
    menu: venue.menu,
  });
}

/** An owner acting for themselves, as the owner routes see them. */
const asOwner = (userId: string): AccountContext => ({
  kind: 'account',
  userId,
  sessionId: SEED_EDITOR_CONTEXT.sessionId,
  deviceId: null,
  permissions: ['owner.access'],
  ownerVerified: true,
  emailVerified: true,
  origin: SYSTEM_ORIGIN,
});

/** What the Vĩnh Khánh seed calls. */
export interface PilotD4Deps {
  readonly prisma: PrismaService;
  readonly areas: Pick<AreasService, 'upsertArea'>;
  readonly places: Pick<PlacesService, 'placeView'>;
  readonly submissions: Pick<SubmissionsService, 'createSubmission'>;
  readonly review: Pick<SubmissionReviewService, 'approveSubmission'>;
  readonly billing: Pick<BillingPortService, 'getEntitlementsVersion'>;
  readonly ownerEntitlements: Pick<OwnerEntitlementsService, 'current'>;
}

/** How long to wait for each owner's grants to reach catalog, and how often to look. */
export interface SeedWait {
  readonly timeoutMs: number;
  readonly intervalMs: number;
}

const DEFAULT_WAIT: SeedWait = { timeoutMs: 60_000, intervalMs: 500 };

/**
 * Waits until catalog's copy of each owner's grants (C-18) has reached the version billing holds
 * now — so a Venue is approved with its owner's auto-narration and languages, never Free's by
 * accident. Throws naming who is behind.
 */
export async function waitForGrants(
  deps: Pick<PilotD4Deps, 'prisma' | 'billing' | 'ownerEntitlements'>,
  ownerUserIds: readonly string[],
  wait: SeedWait = DEFAULT_WAIT,
): Promise<void> {
  const wanted = new Map<string, number>();
  for (const id of ownerUserIds) wanted.set(id, await deps.billing.getEntitlementsVersion(id));
  const deadline = Date.now() + wait.timeoutMs;
  for (;;) {
    const behind: string[] = [];
    for (const [id, version] of wanted) {
      const known = await deps.ownerEntitlements.current(deps.prisma, id);
      if (known === null || known.version < version) behind.push(id);
    }
    if (behind.length === 0) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `waited ${wait.timeoutMs / 1000} s for catalog's copy of the owners' grants ` +
          `(billing.entitlements.changed); still behind for ${behind.join(', ')}. ` +
          'Are billing and catalog running?',
      );
    }
    await new Promise((done) => setTimeout(done, wait.intervalMs));
  }
}

/** One reported row. */
export interface D4Row {
  readonly slug: string;
  readonly outcome: 'created' | 'updated' | 'unchanged' | 'skipped' | 'submitted';
  readonly detail?: string;
}

/** What a run did. */
export interface D4Report {
  readonly area: string;
  readonly rows: readonly D4Row[];
}

/**
 * The Vĩnh Khánh reconcile (ADR 0002): create what is missing through a submission and its
 * approval, update what differs through an `UPDATE`, leave deletions alone, never delete. A Venue
 * with a `PENDING` submission is skipped, so the queue's pending edit is never replaced.
 */
export async function seedPilotD4(
  deps: PilotD4Deps,
  corpus: PilotD4Corpus,
  reviewer: AccountContext,
  wait?: SeedWait,
): Promise<D4Report> {
  const area = await deps.areas.upsertArea(reviewer, { ...corpus.area, isActive: true });
  if (isAreaRefusal(area)) {
    throw new Error(`${corpus.area.code}: ${area.outcome} — ${JSON.stringify(area)}`);
  }
  const ownerOf = (slug: string) => corpus.owners.get(slug)!;
  await waitForGrants(
    deps,
    [...new Set(corpus.venues.map((venue) => ownerOf(venue.ownerSlug)))],
    wait,
  );

  const rows: D4Row[] = [];
  for (const venue of corpus.venues)
    rows.push(await reconcile(deps, venue, ownerOf(venue.ownerSlug), reviewer));

  // The queue: a creation and an edit, submitted and left for a reviewer.
  const { create, update } = corpus.pending;
  rows.push(
    await submitOnce(deps, create.submissionId, `${create.slug} (pending creation)`, () =>
      deps.submissions.createSubmission(
        {
          kind: submissionKindProto.toProto(SubmissionKind.CREATE),
          payloadJson: JSON.stringify(payloadOf(create)),
        },
        asOwner(ownerOf(create.ownerSlug)),
        { id: create.submissionId },
      ),
    ),
  );
  const edited = corpus.venues.find((venue) => venue.slug === update.venueSlug)!;
  rows.push(
    await submitOnce(deps, update.submissionId, `${edited.slug} (pending edit)`, async () => {
      const live = await deps.places.placeView(deps.prisma, edited.id);
      return deps.submissions.createSubmission(
        {
          kind: submissionKindProto.toProto(SubmissionKind.UPDATE),
          placeId: edited.id,
          baseEditableHash: editableHash(snapshotOfPlace(live)),
          payloadJson: JSON.stringify(payloadOf(edited, update.descriptionVi)),
        },
        asOwner(ownerOf(edited.ownerSlug)),
        { id: update.submissionId },
      );
    }),
  );
  return { area: `${corpus.area.code}: ${area.outcome}`, rows };
}

/** Submits once: a committed submission that exists, in any status, is left as it is. */
async function submitOnce(
  deps: PilotD4Deps,
  submissionId: string,
  slug: string,
  submit: () => Promise<unknown>,
): Promise<D4Row> {
  const existing = await deps.prisma.placeSubmission.findUnique({
    where: { id: submissionId },
    select: { status: true },
  });
  if (existing !== null) return { slug, outcome: 'unchanged', detail: existing.status };
  await submit();
  return { slug, outcome: 'submitted' };
}

async function reconcile(
  deps: PilotD4Deps,
  venue: PilotVenue,
  ownerUserId: string,
  reviewer: AccountContext,
): Promise<D4Row> {
  const payload = payloadOf(venue);
  const editorial = {
    triggerRadiusM: venue.triggerRadiusM,
    narrationPriority: venue.narrationPriority,
    acknowledgeConflict: false,
  };
  const place = await deps.prisma.place.findUnique({
    where: { id: venue.id },
    select: { id: true, triggerRadiusM: true, narrationPriority: true },
  });
  if (place === null) {
    const submission = await deps.prisma.placeSubmission.findUnique({
      where: { id: venue.submissionId },
      select: { status: true },
    });
    if (submission === null) {
      await deps.submissions.createSubmission(
        {
          kind: submissionKindProto.toProto(SubmissionKind.CREATE),
          payloadJson: JSON.stringify(payload),
        },
        asOwner(ownerUserId),
        { id: venue.submissionId },
      );
    } else if (submission.status !== String(SubmissionStatus.PENDING)) {
      return {
        slug: venue.slug,
        outcome: 'skipped',
        detail: `its creation is ${submission.status}`,
      };
    }
    await deps.review.approveSubmission(
      { submissionId: venue.submissionId, ...editorial },
      reviewer,
      { id: venue.id, publicCode: venue.publicCode },
    );
    return { slug: venue.slug, outcome: 'created' };
  }
  const pending = await deps.prisma.placeSubmission.findFirst({
    where: { placeId: venue.id, status: SubmissionStatus.PENDING },
    select: { id: true },
  });
  if (pending !== null) {
    return {
      slug: venue.slug,
      outcome: 'skipped',
      detail: `a submission is pending (${pending.id})`,
    };
  }
  const live = await deps.places.placeView(deps.prisma, venue.id);
  const fields = changedFields(snapshotOfPlace(live), snapshotOfPayload(payload));
  const editorialChanged =
    place.triggerRadiusM !== venue.triggerRadiusM ||
    place.narrationPriority !== venue.narrationPriority;
  if (fields.length === 0 && !editorialChanged) return { slug: venue.slug, outcome: 'unchanged' };
  const { submission } = await deps.submissions.createSubmission(
    {
      kind: submissionKindProto.toProto(SubmissionKind.UPDATE),
      placeId: venue.id,
      baseEditableHash: editableHash(snapshotOfPlace(live)),
      payloadJson: JSON.stringify(payload),
    },
    asOwner(ownerUserId),
  );
  await deps.review.approveSubmission({ submissionId: submission!.id, ...editorial }, reviewer);
  return {
    slug: venue.slug,
    outcome: 'updated',
    detail: [...fields, ...(editorialChanged ? ['editorial'] : [])].join(', '),
  };
}

async function main(): Promise<void> {
  assertNotProduction(process.env);
  config({ path: resolve(packageRoot(__dirname), '.env'), quiet: true });
  if (process.env.PRISMA_DB === 'test') process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  const corpus = loadPilotD4();
  const app = await NestFactory.createApplicationContext(AppModule.forRoot({ jobs: false }), {
    logger: ['error', 'warn'],
  });
  try {
    const report = await seedPilotD4(
      {
        prisma: app.get(PrismaService),
        areas: app.get(AreasService),
        places: app.get(PlacesService),
        submissions: app.get(SubmissionsService),
        review: app.get(SubmissionReviewService),
        billing: app.get(BillingPortService),
        ownerEntitlements: app.get(OwnerEntitlementsService),
      },
      corpus,
      SEED_EDITOR_CONTEXT,
    );
    console.log(`✓ ${report.area}`);
    for (const row of report.rows) {
      console.log(
        `✓ ${row.outcome} ${row.slug}${row.detail === undefined ? '' : ` — ${row.detail}`}`,
      );
    }
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
