// `/owner/places`, `/owner/submissions` and `/admin/submissions` (api-endpoints-plan §3.1–§3.4):
// who may call them, what the gateway refuses before catalog, and how catalog's answers map.
import { status } from '@grpc/grpc-js';
import { FREE_PLAN_GRANTS, newId, SubmissionKind, SubmissionStatus } from '@wayfare/contracts';
import { catalogGrpc, submissionKindProto, submissionStatusProto } from '@wayfare/contracts/grpc';
import { adminPlaceFixture, FIXTURE_INSIDE } from '@wayfare/contracts/testing';
import { toProtoTimestamp } from '@wayfare/nest-common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountToken, bootGateway, serviceError } from '../support/app';
import type { E2eApp } from '../support/app';

let gateway: E2eApp;
const ownerId = newId();
const owner = () =>
  `wf_at=${accountToken({ userId: ownerId, ov: true, ev: true, perms: ['owner.access'] })}`;
const staff = (perms: string[]) => `wf_at=${accountToken({ userId: newId(), perms })}`;
const call = (method: 'get' | 'post', path: string, cookie: string) => {
  const agent = request(gateway.app.getHttpServer());
  return agent[method](`/api/v1${path}`).set('X-Wayfare-Client', 'console').set('Cookie', cookie);
};

beforeAll(async () => {
  gateway = await bootGateway();
});
afterAll(() => gateway.app.close());
beforeEach(() => {
  gateway.catalog.reset();
  gateway.redis.values.clear();
});

const payload = {
  nameVi: 'Quán Bún Chả',
  descriptionVi: 'Bún chả Hà Nội.',
  categoryCode: 'RESTAURANT',
  location: FIXTURE_INSIDE,
  addressVi: null,
  priceBand: null,
  phone: null,
  websiteUrl: null,
  openingHours: [],
  photos: [],
  menu: { menuCurrency: 'VND', items: [] },
};

function submission(over: Partial<catalogGrpc.Submission> = {}): catalogGrpc.Submission {
  return {
    id: newId(),
    kind: submissionKindProto.toProto(SubmissionKind.CREATE),
    status: submissionStatusProto.toProto(SubmissionStatus.PENDING),
    ownerUserId: ownerId,
    payloadJson: JSON.stringify(payload),
    payloadSchemaVersion: 1,
    submittedAt: toProtoTimestamp(new Date('2026-09-19T10:00:00.000Z')),
    reviewedAt: undefined,
    ...over,
  };
}

describe('/owner/submissions', () => {
  it('creates a submission: 201, the payload forwarded as JSON', async () => {
    const created = submission();
    gateway.catalog.submissions.handlers.createSubmission = () =>
      Promise.resolve({ submission: created });
    const res = await call('post', '/owner/submissions', owner()).send({
      kind: 'CREATE',
      payload,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.submission).toMatchObject({
      id: created.id,
      kind: 'CREATE',
      status: 'PENDING',
      placeId: null,
      payload: { nameVi: 'Quán Bún Chả' },
    });
    const sent = gateway.catalog.submissions.calls[0]!
      .request as catalogGrpc.CreateSubmissionRequest;
    expect(sent.kind).toBe(catalogGrpc.SubmissionKind.SUBMISSION_KIND_CREATE);
    expect(JSON.parse(sent.payloadJson)).toEqual(payload);
  });

  it('refuses before catalog: editorial fields, a missing field, and an UPDATE without its base', async () => {
    for (const body of [
      { kind: 'CREATE', payload: { ...payload, triggerRadiusM: 50 } },
      { kind: 'CREATE', payload: { ...payload, addressVi: undefined } },
      { kind: 'UPDATE', placeId: newId(), payload },
      { kind: 'CREATE', placeId: newId(), baseEditableHash: 'a'.repeat(64), payload },
    ]) {
      const res = await call('post', '/owner/submissions', owner()).send(body);
      expect(res.status).toBe(400);
    }
    expect(gateway.catalog.submissions.calls).toHaveLength(0);
  });

  it('is for verified owners only', async () => {
    const res = await call('post', '/owner/submissions', staff(['place.update'])).send({
      kind: 'CREATE',
      payload,
    });
    expect(res.status).toBe(403);
  });

  it('passes catalog’s refusals through with their details', async () => {
    gateway.catalog.submissions.handlers.createSubmission = () =>
      Promise.reject(
        serviceError(status.FAILED_PRECONDITION, {
          'wf-error-code': 'PLACE_LIMIT_REACHED',
          'wf-error-details': JSON.stringify({ limit: 1 }),
        }),
      );
    const res = await call('post', '/owner/submissions', owner()).send({ kind: 'CREATE', payload });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'PLACE_LIMIT_REACHED', details: { limit: 1 } });
  });

  it('lists with a cursor and withdraws', async () => {
    gateway.catalog.submissions.handlers.listMySubmissions = () =>
      Promise.resolve({ submissions: [submission()], page: { nextCursor: 'abc' } });
    const list = await call('get', '/owner/submissions?status=PENDING', owner());
    expect(list.status).toBe(200);
    expect(list.body.meta).toEqual({ nextCursor: 'abc' });
    const withdrawn = submission({
      status: submissionStatusProto.toProto(SubmissionStatus.WITHDRAWN),
    });
    gateway.catalog.submissions.handlers.withdrawSubmission = () =>
      Promise.resolve({ submission: withdrawn });
    const res = await call('post', `/owner/submissions/${withdrawn.id}/withdraw`, owner());
    expect(res.status).toBe(200);
    expect(res.body.data.submission.status).toBe('WITHDRAWN');
  });
});

describe('/admin/submissions', () => {
  it('shows the reviewer the live Venue, the diff, the plan and the conflict', async () => {
    const view: catalogGrpc.SubmissionAdmin = {
      submission: submission({ kind: submissionKindProto.toProto(SubmissionKind.UPDATE) }),
      internalNote: 'checked',
      livePlace: adminPlaceFixture(),
      diffJson: JSON.stringify([{ field: 'phone', before: null, after: '+84901234567' }]),
      entitlementsJson: JSON.stringify(FREE_PLAN_GRANTS),
      conflictChangedFields: ['phone'],
    };
    gateway.catalog.submissionReview.handlers.getSubmission = () =>
      Promise.resolve({ submission: view });
    const res = await call('get', `/admin/submissions/${newId()}`, staff(['submission.read']));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      internalNote: 'checked',
      diff: [{ field: 'phone', before: null, after: '+84901234567' }],
      entitlements: { maxPlaces: 1 },
      conflict: { changedFields: ['phone'] },
      livePlace: { id: view.livePlace!.id },
    });
    expect((await call('get', `/admin/submissions/${newId()}`, owner())).status).toBe(403);
  });

  it('approves with the reviewer’s values, and maps a conflict to 409 with its fields', async () => {
    gateway.catalog.submissionReview.handlers.approveSubmission = () =>
      Promise.reject(
        serviceError(status.FAILED_PRECONDITION, {
          'wf-error-code': 'SUBMISSION_CONFLICT',
          'wf-error-details': JSON.stringify({ changedFields: ['phone'] }),
        }),
      );
    const id = newId();
    const res = await call(
      'post',
      `/admin/submissions/${id}/approve`,
      staff(['submission.review']),
    ).send({ triggerRadiusM: 30, narrationPriority: 60 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'SUBMISSION_CONFLICT',
      details: { changedFields: ['phone'] },
    });
    expect(gateway.catalog.submissionReview.calls[0]!.request).toMatchObject({
      submissionId: id,
      triggerRadiusM: 30,
      narrationPriority: 60,
      acknowledgeConflict: false,
    });
    const tooWide = await call(
      'post',
      `/admin/submissions/${id}/approve`,
      staff(['submission.review']),
    ).send({ triggerRadiusM: 500, narrationPriority: 60 });
    expect(tooWide.status).toBe(400);
    const noNote = await call(
      'post',
      `/admin/submissions/${id}/reject`,
      staff(['submission.review']),
    ).send({});
    expect(noNote.status).toBe(400);
  });
});

describe('/owner/places', () => {
  it('answers the limits before reading `limits` as an id, and a Venue beside its pending edit', async () => {
    gateway.catalog.ownerPlaces.handlers.getMyLimits = () =>
      Promise.resolve({
        maxPlaces: 10,
        used: 1,
        reservedByPendingSubmissions: 1,
        maxPhotosPerPlace: 8,
        maxMenuItemsPerPlace: 200,
        narrationLanguageScope: 'LAUNCH',
        autoNarration: true,
      });
    const limits = await call('get', '/owner/places/limits', owner());
    expect(limits.status).toBe(200);
    expect(limits.body.data).toMatchObject({ used: 1, reservedByPendingSubmissions: 1 });
    expect(gateway.catalog.ownerPlaces.calls.map((c) => c.method)).toEqual(['getMyLimits']);

    const place = adminPlaceFixture();
    gateway.catalog.ownerPlaces.handlers.getMyPlace = () =>
      Promise.resolve({
        place,
        editableHash: 'b'.repeat(64),
        pendingSubmission: submission({ kind: submissionKindProto.toProto(SubmissionKind.UPDATE) }),
      });
    const detail = await call('get', `/owner/places/${place.id}`, owner());
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({
      place: { id: place.id },
      editableHash: 'b'.repeat(64),
      pendingSubmission: { kind: 'UPDATE' },
    });
  });

  it('deactivates, and passes a refused reactivation through', async () => {
    const place = adminPlaceFixture();
    gateway.catalog.ownerPlaces.handlers.deactivateMyPlace = () => Promise.resolve({ place });
    expect((await call('post', `/owner/places/${place.id}/deactivate`, owner())).status).toBe(200);
    gateway.catalog.ownerPlaces.handlers.reactivateMyPlace = () =>
      Promise.reject(
        serviceError(status.FAILED_PRECONDITION, {
          'wf-error-code': 'INVALID_STATE',
          'wf-error-details': JSON.stringify({ status: 'INACTIVE' }),
        }),
      );
    const res = await call('post', `/owner/places/${place.id}/reactivate`, owner());
    expect(res.status).toBe(409);
  });
});
