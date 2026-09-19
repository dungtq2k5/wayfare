// Owner submissions and their review (api-endpoints-plan §3.1–§3.4, rdm-spec C-11): what a
// submission checks, the place limit under the owner's lock, approval through the ordinary write
// steps with the reviewer's values, conflicts decided on owner-editable fields, and the owner's
// own Venue routes.
import {
  AUDIT_RECORD,
  AuditAction,
  BILLING_ENTITLEMENTS_CHANGED,
  CATALOG_PLACE_CONTENT_CHANGED,
  CATALOG_SUBMISSION_REVIEWED,
  compareStrings,
  FREE_PLAN_GRANTS,
  IDENTITY_USER_ERASED,
  MenuCurrency,
  newId,
  NOTIFICATION_CREATE,
  PlaceKind,
  PlaceStatus,
  SubmissionKind,
  SubmissionStatus,
  SynthesisTrigger,
} from '@wayfare/contracts';
import type { PlaceSubmissionPayload } from '@wayfare/contracts';
import {
  catalogGrpc,
  placeStatusProto,
  submissionKindProto,
  submissionStatusProto,
} from '@wayfare/contracts/grpc';
import { FIXTURE_INSIDE, FIXTURE_OUTSIDE } from '@wayfare/contracts/testing';
import type { AccountContext } from '@wayfare/nest-common';
import { buildAccountContext } from '@wayfare/nest-common/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testPrisma, truncateAll } from '../setup/database';
import {
  confirmedUpload,
  errorOf,
  insertLocalization,
  insertPlace,
  outboxPayloads,
  staff,
  taxonomy,
  updateRequest,
} from '../setup/fixtures';
import { catalogServices, GROWTH_GRANTS } from '../setup/services';

const prisma = testPrisma();
let services: ReturnType<typeof catalogServices>;
let tax: Awaited<ReturnType<typeof taxonomy>>;
let owner: AccountContext;
const moderator = () =>
  buildAccountContext({ permissions: ['submission.read', 'submission.review'] });

beforeEach(async () => {
  await truncateAll(prisma);
  services = catalogServices(prisma);
  tax = await taxonomy(prisma);
  owner = buildAccountContext({ ownerVerified: true, permissions: ['owner.access'] });
});
afterAll(() => prisma.$disconnect());

function payload(over: Partial<PlaceSubmissionPayload> = {}): PlaceSubmissionPayload {
  return {
    nameVi: 'Quán Bún Chả',
    descriptionVi: 'Bún chả Hà Nội.',
    categoryCode: 'RESTAURANT',
    location: FIXTURE_INSIDE,
    addressVi: '12 Lê Lợi',
    priceBand: 2,
    phone: '+84901234567',
    websiteUrl: null,
    openingHours: [{ weekday: 1, opensAt: '08:00', closesAt: '21:00', isClosed: false }],
    photos: [],
    menu: {
      menuCurrency: MenuCurrency.VND,
      items: [{ nameVi: 'Bún chả', descriptionVi: null, priceMinor: 45000, isAvailable: true }],
    },
    ...over,
  };
}

const create = (body: unknown, as: AccountContext = owner) =>
  services.submissions.createSubmission(
    { kind: submissionKindProto.toProto(SubmissionKind.CREATE), payloadJson: JSON.stringify(body) },
    as,
  );

const update = (placeId: string, hash: string, body: unknown, as: AccountContext = owner) =>
  services.submissions.createSubmission(
    {
      kind: submissionKindProto.toProto(SubmissionKind.UPDATE),
      placeId,
      baseEditableHash: hash,
      payloadJson: JSON.stringify(body),
    },
    as,
  );

const approve = (submissionId: string, over: Partial<catalogGrpc.ApproveSubmissionRequest> = {}) =>
  services.review.approveSubmission(
    {
      submissionId,
      triggerRadiusM: 30,
      narrationPriority: 60,
      acknowledgeConflict: false,
      ...over,
    },
    moderator(),
  );

async function ownersVenue(status: PlaceStatus = PlaceStatus.ACTIVE) {
  const place = await insertPlace(prisma, {
    areaId: tax.area.id,
    categoryId: tax.venueOnly.id,
    kind: PlaceKind.VENUE,
    status,
    ownerUserId: owner.userId,
  });
  return place.id;
}

describe('creating a submission', () => {
  it('stores a pending CREATE that reserves a slot, without consuming its uploads', async () => {
    const upload = await confirmedUpload(prisma, owner.userId);
    const { submission } = await create(
      payload({ photos: [{ uploadId: upload.id, altTextVi: null }] }),
    );
    expect(submission).toMatchObject({
      status: submissionStatusProto.toProto(SubmissionStatus.PENDING),
      ownerUserId: owner.userId,
      payloadSchemaVersion: 1,
    });
    expect(submission!.placeId).toBeUndefined();
    const limits = await services.ownerPlaces.getMyLimits(owner);
    expect(limits).toMatchObject({ maxPlaces: 10, used: 0, reservedByPendingSubmissions: 1 });
    expect(
      (await prisma.pendingUpload.findUniqueOrThrow({ where: { id: upload.id } })).consumedAt,
    ).toBeNull();
    const audits = await outboxPayloads(prisma, AUDIT_RECORD.subject);
    expect(audits).toEqual([
      expect.objectContaining({
        action: AuditAction.SUBMISSION_CREATED,
        resource: { type: 'SUBMISSION', id: submission!.id },
        metadata: { after: { kind: 'CREATE' } },
      }),
    ]);
  });

  it('refuses what the owner may not set or name', async () => {
    const withRadius = await errorOf(create({ ...payload(), triggerRadiusM: 50 }));
    expect(withRadius.code).toBe('VALIDATION_FAILED');
    // Nothing absent means "unchanged": every optional field is stated.
    const { addressVi: _dropped, ...partial } = payload();
    expect((await errorOf(create(partial))).code).toBe('VALIDATION_FAILED');
    expect((await errorOf(create(payload({ location: FIXTURE_OUTSIDE })))).code).toBe(
      'LOCATION_OUTSIDE_AREAS',
    );
    expect(await errorOf(create(payload({ categoryCode: 'NOPE' })))).toEqual({
      code: 'RESOURCE_NOT_FOUND',
      details: { resource: 'CATEGORY' },
    });
    const theirs = await confirmedUpload(prisma, newId());
    expect(
      await errorOf(create(payload({ photos: [{ uploadId: theirs.id, altTextVi: null }] }))),
    ).toEqual({ code: 'RESOURCE_NOT_FOUND', details: { resource: 'UPLOAD' } });
    const used = await confirmedUpload(prisma, owner.userId, { consumedAt: new Date() });
    expect(
      (await errorOf(create(payload({ photos: [{ uploadId: used.id, altTextVi: null }] })))).code,
    ).toBe('UPLOAD_NOT_READY');
    expect(
      await errorOf(create(payload({ photos: [{ photoId: newId(), altTextVi: null }] }))),
    ).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await prisma.placeSubmission.count()).toBe(0);
  });

  it('checks the plan: places, photos and menu items', async () => {
    services.billing.grants.set(owner.userId, FREE_PLAN_GRANTS);
    await ownersVenue();
    expect(await errorOf(create(payload()))).toEqual({
      code: 'PLACE_LIMIT_REACHED',
      details: { limit: 1 },
    });
    const uploads = await Promise.all(
      Array.from({ length: 4 }, () => confirmedUpload(prisma, owner.userId)),
    );
    expect(
      await errorOf(
        create(payload({ photos: uploads.map((u) => ({ uploadId: u.id, altTextVi: null })) })),
      ),
    ).toEqual({
      code: 'PHOTO_LIMIT_REACHED',
      details: { limit: FREE_PLAN_GRANTS.maxPhotosPerPlace },
    });
    services.billing.down = true;
    expect((await errorOf(create(payload()))).code).toBe('ENTITLEMENTS_UNAVAILABLE');
  });

  it('lets only one of two concurrent creations take the last slot', async () => {
    services.billing.grants.set(owner.userId, { ...GROWTH_GRANTS, maxPlaces: 1 });
    // A success makes errorOf throw; it is recorded as OK.
    const attempt = () =>
      errorOf(create(payload())).then(
        (e) => e.code,
        () => 'OK',
      );
    expect((await Promise.all([attempt(), attempt()])).toSorted()).toEqual([
      'OK',
      'PLACE_LIMIT_REACHED',
    ]);
  });

  it('frees a slot when the owner withdraws; another owner cannot see or withdraw it', async () => {
    services.billing.grants.set(owner.userId, { ...GROWTH_GRANTS, maxPlaces: 1 });
    const { submission } = await create(payload());
    const stranger = buildAccountContext({ ownerVerified: true });
    expect(
      await errorOf(
        services.submissions.getMySubmission({ submissionId: submission!.id }, stranger),
      ),
    ).toEqual({ code: 'RESOURCE_NOT_FOUND', details: { resource: 'SUBMISSION' } });
    await services.submissions.withdrawSubmission({ submissionId: submission!.id }, owner);
    expect((await services.ownerPlaces.getMyLimits(owner)).reservedByPendingSubmissions).toBe(0);
    expect(
      (
        await errorOf(
          services.submissions.withdrawSubmission({ submissionId: submission!.id }, owner),
        )
      ).code,
    ).toBe('INVALID_STATE');
    await create(payload());
  });
});

describe('approving a CREATE', () => {
  it('creates the Venue with the reviewer’s values, the owner’s photos, menu and hours', async () => {
    await services.ownerEntitlements.record(
      prisma,
      BILLING_ENTITLEMENTS_CHANGED.schema.parse({
        eventId: newId(),
        occurredAt: new Date().toISOString(),
        ownerUserId: owner.userId,
        entitlementsVersion: 2,
        entitlements: GROWTH_GRANTS,
        previous: null,
      }),
    );
    const old = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    const photo = await confirmedUpload(prisma, owner.userId, { confirmedAt: old });
    const { submission } = await create(
      payload({ photos: [{ uploadId: photo.id, altTextVi: 'Mặt tiền' }] }),
    );
    const { submission: approved } = await approve(submission!.id, {
      decisionNote: 'Welcome',
      internalNote: 'checked on the map',
    });
    expect(approved).toMatchObject({
      status: submissionStatusProto.toProto(SubmissionStatus.APPROVED),
      decisionNote: 'Welcome',
    });
    const place = await prisma.place.findUniqueOrThrow({
      where: { id: approved!.placeId! },
      include: { photos: true, menuItems: true, openingHours: true },
    });
    expect(place).toMatchObject({
      kind: PlaceKind.VENUE,
      ownerUserId: owner.userId,
      status: PlaceStatus.PROCESSING,
      triggerRadiusM: 30,
      narrationPriority: 60,
      autoNarrationEnabled: true,
      phone: '+84901234567',
    });
    expect(place.activationRequestedAt).not.toBeNull();
    // The upload was 20 days old: held by the submission, still consumed at approval.
    expect(place.photos).toEqual([
      expect.objectContaining({ uploadedById: owner.userId, altTextVi: 'Mặt tiền' }),
    ]);
    expect(place.menuItems).toHaveLength(1);
    expect(place.openingHours).toHaveLength(1);
    const narration = await outboxPayloads(prisma, CATALOG_PLACE_CONTENT_CHANGED.subject);
    expect(narration).toEqual([
      expect.objectContaining({ placeId: place.id, trigger: SynthesisTrigger.APPROVAL }),
    ]);
    expect(await outboxPayloads(prisma, CATALOG_SUBMISSION_REVIEWED.subject)).toEqual([
      expect.objectContaining({
        submissionId: submission!.id,
        placeId: place.id,
        ownerUserId: owner.userId,
        decision: 'APPROVED',
        decisionNote: 'Welcome',
      }),
    ]);
    const approvedAudit = (await outboxPayloads(prisma, AUDIT_RECORD.subject)).find(
      (row) => row.action === AuditAction.SUBMISSION_APPROVED,
    );
    expect(approvedAudit).toMatchObject({
      metadata: {
        after: {
          kind: 'CREATE',
          placeId: place.id,
          triggerRadiusM: 30,
          narrationPriority: 60,
          categoryCode: 'RESTAURANT',
          categoryOverridden: false,
          hasDecisionNote: true,
          hasInternalNote: true,
        },
      },
    });
    expect(services.frames.sent).toEqual([
      {
        room: `owner:${owner.userId}`,
        event: 'ownerPlaceStatus',
        payload: { placeId: place.id, status: PlaceStatus.PROCESSING, inactiveReason: null },
      },
    ]);
    // The owner's own view never carries the internal note.
    const mine = await services.submissions.getMySubmission(
      { submissionId: submission!.id },
      owner,
    );
    expect(JSON.stringify(mine)).not.toContain('checked on the map');
  });

  it('refuses a creation the owner, the plan or a concurrent reviewer no longer allows', async () => {
    const { submission } = await create(payload());
    services.identity.owners.set(owner.userId, { verified: true, live: false });
    expect(await errorOf(approve(submission!.id))).toEqual({
      code: 'INVALID_STATE',
      details: { status: 'OWNER_NOT_VERIFIED' },
    });
    services.identity.owners.clear();
    services.identity.down = true;
    expect((await errorOf(approve(submission!.id))).code).toBe('UPSTREAM_UNAVAILABLE');
    services.identity.down = false;
    services.billing.grants.set(owner.userId, FREE_PLAN_GRANTS);
    await ownersVenue();
    expect((await errorOf(approve(submission!.id))).code).toBe('PLACE_LIMIT_REACHED');
    expect(
      (await prisma.placeSubmission.findUniqueOrThrow({ where: { id: submission!.id } })).status,
    ).toBe(SubmissionStatus.PENDING);
    services.billing.grants.delete(owner.userId);
    const outcomes = await Promise.allSettled([approve(submission!.id), approve(submission!.id)]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.place.count({ where: { ownerUserId: owner.userId } })).toBe(2);
  });

  it('records the reviewer’s category and rejects with a note', async () => {
    const { submission } = await create(payload());
    const { submission: approved } = await approve(submission!.id, {
      categoryCodeOverride: 'MARKET',
    });
    expect(approved!.categoryCodeOverride).toBe('MARKET');
    const place = await prisma.place.findUniqueOrThrow({
      where: { id: approved!.placeId! },
      select: { categoryId: true },
    });
    expect(place.categoryId).toBe(tax.any.id);

    const { submission: second } = await create(payload());
    expect(
      (
        await errorOf(
          services.review.rejectSubmission(
            { submissionId: second!.id, decisionNote: '' },
            moderator(),
          ),
        )
      ).code,
    ).toBe('VALIDATION_FAILED');
    const { submission: rejected } = await services.review.rejectSubmission(
      { submissionId: second!.id, decisionNote: 'Photos are blurry', internalNote: 'duplicate?' },
      moderator(),
    );
    expect(rejected).toMatchObject({
      status: submissionStatusProto.toProto(SubmissionStatus.REJECTED),
      decisionNote: 'Photos are blurry',
    });
    expect(await outboxPayloads(prisma, CATALOG_SUBMISSION_REVIEWED.subject)).toContainEqual(
      expect.objectContaining({ decision: 'REJECTED', decisionNote: 'Photos are blurry' }),
    );
  });
});

describe('an UPDATE', () => {
  async function liveVenue() {
    const { submission } = await create(payload());
    const { submission: approved } = await approve(submission!.id);
    const placeId = approved!.placeId!;
    const detail = await services.ownerPlaces.getMyPlace({ placeId }, owner);
    return { placeId, hash: detail.editableHash, place: detail.place! };
  }

  it('starts from the live fields, supersedes the pending one, and applies without PLACE_EDITED_BY_ADMIN', async () => {
    const { placeId, hash } = await liveVenue();
    const { submission: first } = await update(placeId, hash, payload({ descriptionVi: 'Một.' }));
    const { submission: second } = await update(placeId, hash, payload({ descriptionVi: 'Hai.' }));
    expect(
      (await prisma.placeSubmission.findUniqueOrThrow({ where: { id: first!.id } })).status,
    ).toBe(SubmissionStatus.SUPERSEDED);
    const mine = await services.ownerPlaces.getMyPlace({ placeId }, owner);
    expect(mine.pendingSubmission?.id).toBe(second!.id);
    const detail = await services.review.getSubmission({ submissionId: second!.id }, moderator());
    expect(JSON.parse(detail.submission!.diffJson)).toEqual([
      { field: 'descriptionVi', before: 'Bún chả Hà Nội.', after: 'Hai.' },
    ]);
    expect(detail.submission!.conflictChangedFields).toEqual([]);

    // Narration finishing moves sync_version, not an owner-editable field: no conflict.
    await insertLocalization(prisma, placeId, 'en', 'a'.repeat(64));
    await prisma.$executeRaw`UPDATE places SET sync_version = nextval('catalog_sync_version_seq') WHERE id = ${placeId}::uuid`;
    await approve(second!.id);
    const place = await prisma.place.findUniqueOrThrow({ where: { id: placeId } });
    expect(place.descriptionVi).toBe('Hai.');
    const notices = (await outboxPayloads(prisma, NOTIFICATION_CREATE.subject)).map(
      (row) => (row.notification as { type: string }).type,
    );
    expect(notices).not.toContain('PLACE_EDITED_BY_ADMIN');
  });

  it('names the fields an admin changed since, and applies them only when acknowledged', async () => {
    const { placeId, hash } = await liveVenue();
    const { submission } = await update(placeId, hash, payload({ descriptionVi: 'Mới.' }));
    await services.places.updatePlace(updateRequest(placeId, { phone: '+84999999999' }), staff());
    expect(await errorOf(approve(submission!.id))).toEqual({
      code: 'SUBMISSION_CONFLICT',
      details: { changedFields: ['phone'] },
    });
    const detail = await services.review.getSubmission(
      { submissionId: submission!.id },
      moderator(),
    );
    expect(detail.submission!.conflictChangedFields).toEqual(['phone']);
    await approve(submission!.id, { acknowledgeConflict: true });
    const place = await prisma.place.findUniqueOrThrow({ where: { id: placeId } });
    expect(place).toMatchObject({ descriptionVi: 'Mới.', phone: '+84901234567' });
    // A stale base is refused at submission: the owner reloads.
    expect(await errorOf(update(placeId, hash, payload()))).toEqual({
      code: 'SUBMISSION_CONFLICT',
      details: { changedFields: [] },
    });
  });

  it('is refused for another owner’s Venue, and names a photo not on it at its path', async () => {
    const { placeId, hash } = await liveVenue();
    const stranger = buildAccountContext({ ownerVerified: true });
    expect(await errorOf(update(placeId, hash, payload(), stranger))).toEqual({
      code: 'RESOURCE_NOT_FOUND',
      details: { resource: 'PLACE' },
    });
    const bad = await errorOf(
      update(placeId, hash, payload({ photos: [{ photoId: newId(), altTextVi: null }] })),
    );
    expect(bad).toEqual({
      code: 'VALIDATION_FAILED',
      details: { issues: [{ path: '/payload/photos/0/photoId', code: 'invalid_value' }] },
    });
  });
});

describe('the owner’s Venues', () => {
  it('deactivates from ACTIVE only, and reactivates through the gate within the plan', async () => {
    const active = await ownersVenue(PlaceStatus.ACTIVE);
    const processing = await ownersVenue(PlaceStatus.PROCESSING);
    expect(
      (await errorOf(services.ownerPlaces.deactivateMyPlace({ placeId: processing }, owner))).code,
    ).toBe('INVALID_STATE');
    const { place } = await services.ownerPlaces.deactivateMyPlace({ placeId: active }, owner);
    expect(place).toMatchObject({
      status: placeStatusProto.toProto(PlaceStatus.INACTIVE),
      inactiveReason: catalogGrpc.PlaceInactiveReason.PLACE_INACTIVE_REASON_OWNER,
    });
    expect(services.frames.sent.at(-1)).toMatchObject({
      payload: { placeId: active, status: PlaceStatus.INACTIVE, inactiveReason: 'OWNER' },
    });
    // No English audio yet: back to PROCESSING, waiting on the gate.
    const { place: back } = await services.ownerPlaces.reactivateMyPlace(
      { placeId: active },
      owner,
    );
    expect(back!.status).toBe(placeStatusProto.toProto(PlaceStatus.PROCESSING));
    const audits = (await outboxPayloads(prisma, AUDIT_RECORD.subject)).map((row) => row.action);
    expect(audits).toEqual(
      expect.arrayContaining([
        AuditAction.PLACE_DEACTIVATED_BY_OWNER,
        AuditAction.PLACE_REACTIVATED,
      ]),
    );
  });

  it('refuses an admin’s deactivation, a full plan, and another owner', async () => {
    const byAdmin = await ownersVenue(PlaceStatus.INACTIVE);
    expect(
      (await errorOf(services.ownerPlaces.reactivateMyPlace({ placeId: byAdmin }, owner))).code,
    ).toBe('INVALID_STATE');
    const mine = await ownersVenue(PlaceStatus.ACTIVE);
    await services.ownerPlaces.deactivateMyPlace({ placeId: mine }, owner);
    services.billing.grants.set(owner.userId, FREE_PLAN_GRANTS);
    await ownersVenue(PlaceStatus.ACTIVE);
    expect(await errorOf(services.ownerPlaces.reactivateMyPlace({ placeId: mine }, owner))).toEqual(
      { code: 'PLACE_LIMIT_REACHED', details: { limit: 1 } },
    );
    const stranger = buildAccountContext({ ownerVerified: true });
    expect(await errorOf(services.ownerPlaces.getMyPlace({ placeId: mine }, stranger))).toEqual({
      code: 'RESOURCE_NOT_FOUND',
      details: { resource: 'PLACE' },
    });
    const { places } = await services.ownerPlaces.listMyPlaces(owner);
    const ids = await prisma.place.findMany({
      where: { ownerUserId: owner.userId },
      select: { id: true },
    });
    expect(places.map((place) => place.id).toSorted(compareStrings)).toEqual(
      ids.map((row) => row.id).toSorted(compareStrings),
    );
  });
});

describe('uploads, reaping and erasure', () => {
  it('keeps an old upload a pending submission names, and reaps it once the submission is gone', async () => {
    const old = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    const held = await confirmedUpload(prisma, owner.userId, { confirmedAt: old });
    const loose = await confirmedUpload(prisma, owner.userId, { confirmedAt: old });
    const { submission } = await create(
      payload({ photos: [{ uploadId: held.id, altTextVi: null }] }),
    );
    await services.reap.run();
    expect(await prisma.pendingUpload.count({ where: { id: held.id } })).toBe(1);
    expect(await prisma.pendingUpload.count({ where: { id: loose.id } })).toBe(0);
    await services.submissions.withdrawSubmission({ submissionId: submission!.id }, owner);
    await services.reap.run();
    expect(await prisma.pendingUpload.count({ where: { id: held.id } })).toBe(0);
  });

  it('withdraws an erased owner’s pending submissions', async () => {
    const { submission } = await create(payload());
    await services.places.retireErasedOwner(
      IDENTITY_USER_ERASED.schema.parse({
        eventId: newId(),
        occurredAt: new Date().toISOString(),
        userId: owner.userId,
      }),
      'catalog-identity-user-erased',
    );
    expect(
      (await prisma.placeSubmission.findUniqueOrThrow({ where: { id: submission!.id } })).status,
    ).toBe(SubmissionStatus.WITHDRAWN);
    expect(await outboxPayloads(prisma, AUDIT_RECORD.subject)).toContainEqual(
      expect.objectContaining({
        action: AuditAction.SUBMISSION_WITHDRAWN,
        actor: { type: 'SYSTEM' },
      }),
    );
  });

  it('holds the table’s rules: one pending update per Venue, a base only on updates', async () => {
    const placeId = await ownersVenue();
    const row = (kind: SubmissionKind, extra: Record<string, unknown> = {}) =>
      prisma.placeSubmission.create({
        data: {
          id: newId(),
          kind,
          placeId,
          ownerUserId: owner.userId,
          status: SubmissionStatus.PENDING,
          payload: {},
          payloadSchemaVersion: 1,
          baseEditableHash: kind === SubmissionKind.UPDATE ? 'a'.repeat(64) : null,
          ...(kind === SubmissionKind.UPDATE ? { baseSnapshot: {} } : {}),
          ...extra,
        },
      });
    await row(SubmissionKind.UPDATE);
    await expect(row(SubmissionKind.UPDATE)).rejects.toThrow();
    await expect(
      row(SubmissionKind.CREATE, { baseEditableHash: 'b'.repeat(64) }),
    ).rejects.toThrow();
    await expect(
      row(SubmissionKind.CREATE, { status: SubmissionStatus.APPROVED }),
    ).rejects.toThrow();
    await expect(
      prisma.placeSubmission.create({
        data: {
          id: newId(),
          kind: SubmissionKind.UPDATE,
          ownerUserId: owner.userId,
          status: SubmissionStatus.WITHDRAWN,
          payload: {},
          payloadSchemaVersion: 1,
          baseEditableHash: 'c'.repeat(64),
          baseSnapshot: {},
        },
      }),
    ).rejects.toThrow();
  });
});
