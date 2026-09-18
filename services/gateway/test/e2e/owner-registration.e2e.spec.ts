import { status } from '@grpc/grpc-js';
import { LEGAL_DOCUMENT_VERSIONS, newId } from '@wayfare/contracts';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountToken, bootGateway, serviceError } from '../support/app';
import type { E2eApp } from '../support/app';

let gateway: E2eApp;
const userId = newId();
const registrationId = newId();
const NATIONAL_ID = '079201001234';
const SUBMITTED = new Date('2026-09-18T08:00:00Z');
const Status = identityGrpc.OwnerRegistrationStatus;

function call(
  method: 'get' | 'post',
  path: string,
  claims: Parameters<typeof accountToken>[0] = { userId, ev: true },
) {
  const agent = request(gateway.app.getHttpServer());
  return agent[method](`/api/v1${path}`)
    .set('X-Wayfare-Client', 'console')
    .set('Cookie', `wf_at=${accountToken(claims)}`);
}

const staff = (perms: string[]) => ({ userId, perms });

const rateKeys = (cls: string) =>
  [...gateway.redis.values.keys()].filter((key) => key.startsWith(`rl:${cls}:`));

const body = {
  businessName: 'Quán Bún Chả',
  businessAddress: '12 Lê Lợi, Quận 1',
  contactName: 'Nguyễn Văn An',
  contactPhone: '+84901234567',
  nationalId: '079 201 001 234',
  ownerAgreementVersion: LEGAL_DOCUMENT_VERSIONS.OWNER_AGREEMENT,
};

const registration: identityGrpc.OwnerRegistration = {
  id: registrationId,
  status: Status.OWNER_REGISTRATION_STATUS_PENDING,
  businessName: 'Quán Bún Chả',
  businessAddress: '12 Lê Lợi, Quận 1',
  contactName: 'Nguyễn Văn An',
  contactPhone: '+84901234567',
  nationalIdLast4: '1234',
  submittedAt: toProtoTimestamp(SUBMITTED),
  reviewedAt: undefined,
};

const view = {
  id: registrationId,
  status: 'PENDING',
  businessName: 'Quán Bún Chả',
  businessAddress: '12 Lê Lợi, Quận 1',
  businessRegistrationNo: null,
  contactName: 'Nguyễn Văn An',
  contactPhone: '+84901234567',
  nationalIdLast4: '1234',
  applicantNote: null,
  decisionNote: null,
  submittedAt: '2026-09-18T08:00:00.000Z',
  reviewedAt: null,
};

const admin: identityGrpc.OwnerRegistrationAdmin = {
  registration,
  internalNote: 'Called the number.',
  piiRedacted: false,
  applicant: {
    id: userId,
    email: 'an@example.com',
    createdAt: toProtoTimestamp(SUBMITTED),
    emailVerified: true,
    ownerVerified: false,
    isLocked: false,
    deactivated: false,
  },
  priorApplications: [],
};

beforeAll(async () => {
  gateway = await bootGateway();
});
afterAll(() => gateway.app.close());
beforeEach(() => {
  gateway.identity.reset();
  gateway.redis.values.clear();
});

describe('/owner/registration', () => {
  it('applies with a verified email, forwarding the stripped number and never echoing it', async () => {
    gateway.identity.owner.handlers.submitRegistration = () => Promise.resolve({ registration });
    const res = await call('post', '/owner/registration').send(body);
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body).toEqual({ data: { registration: view } });
    expect(JSON.stringify(res.body)).not.toContain(NATIONAL_ID);
    expect(gateway.identity.owner.calls[0]!.request).toMatchObject({ nationalId: NATIONAL_ID });
  });

  it('refuses an unverified email and a malformed number, echoing neither', async () => {
    const unverified = await call('post', '/owner/registration', { userId, ev: false }).send(body);
    expect(unverified.status).toBe(403);
    expect(unverified.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    const malformed = await call('post', '/owner/registration').send({
      ...body,
      nationalId: '07920100123',
    });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.details.issues).toEqual([
      expect.objectContaining({ path: '/nationalId' }),
    ]);
    expect(JSON.stringify(malformed.body)).not.toContain('07920100123');
    expect(gateway.identity.owner.calls).toHaveLength(0);
  });

  it('passes identity’s conflict through', async () => {
    gateway.identity.owner.handlers.submitRegistration = () =>
      Promise.reject(
        serviceError(status.ALREADY_EXISTS, { 'wf-error-code': 'REGISTRATION_ALREADY_PENDING' }),
      );
    const res = await call('post', '/owner/registration').send(body);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REGISTRATION_ALREADY_PENDING');
  });

  it('lists the caller’s applications and withdraws one with 200', async () => {
    gateway.identity.owner.handlers.listMyRegistrations = () =>
      Promise.resolve({ registrations: [registration] });
    gateway.identity.owner.handlers.withdrawRegistration = () =>
      Promise.resolve({
        registration: { ...registration, status: Status.OWNER_REGISTRATION_STATUS_WITHDRAWN },
      });
    const list = await call('get', '/owner/registration', { userId });
    expect(list.status).toBe(200);
    expect(list.body).toEqual({ data: [view] });
    const withdrawn = await call('post', `/owner/registration/${registrationId}/withdraw`, {
      userId,
    });
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.data.registration.status).toBe('WITHDRAWN');
    expect(gateway.identity.owner.calls[1]!.request).toEqual({ registrationId });
  });
});

describe('/admin/owner-registrations', () => {
  it('lists the PENDING queue by default, page style', async () => {
    gateway.identity.ownerReview.handlers.listRegistrations = () =>
      Promise.resolve({
        registrations: [
          {
            registration,
            piiRedacted: false,
            applicant: { id: userId, email: 'an@example.com' },
          },
        ],
        page: { page: 1, pageSize: 20, total: 1 },
      });
    const res = await call(
      'get',
      '/admin/owner-registrations?q=b%C3%BAn',
      staff(['owner_registration.read']),
    );
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toEqual({
      ...view,
      internalNote: null,
      reviewedById: null,
      piiRedacted: false,
      applicant: { id: userId, email: 'an@example.com', fullName: null },
    });
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(gateway.identity.ownerReview.calls[0]!.request).toEqual({
      page: { page: 1, pageSize: 20, sort: '', q: 'bún' },
      status: Status.OWNER_REGISTRATION_STATUS_PENDING,
    });
  });

  it('refuses a caller without the permission', async () => {
    const res = await call('get', '/admin/owner-registrations', staff([]));
    expect(res.status).toBe(403);
    expect(gateway.identity.ownerReview.calls).toHaveLength(0);
  });

  it('reveals under pii.read only, never cached, under PII_REVEAL', async () => {
    gateway.identity.ownerReview.handlers.revealNationalId = () =>
      Promise.resolve({ nationalId: NATIONAL_ID });
    const path = `/admin/owner-registrations/${registrationId}/national-id/reveal`;
    const moderator = await call(
      'post',
      path,
      staff(['owner_registration.read', 'owner_registration.review']),
    );
    expect(moderator.status).toBe(403);
    const res = await call('post', path, staff(['owner_registration.pii.read']));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body).toEqual({ data: { nationalId: NATIONAL_ID } });
    expect(rateKeys('PII_REVEAL')).toEqual([`rl:PII_REVEAL:userId:${userId}`]);

    gateway.identity.ownerReview.handlers.revealNationalId = () =>
      Promise.reject(
        serviceError(status.FAILED_PRECONDITION, { 'wf-error-code': 'NATIONAL_ID_REDACTED' }),
      );
    const gone = await call('post', path, staff(['owner_registration.pii.read']));
    expect(gone.status).toBe(410);
    expect(gone.body.error.code).toBe('NATIONAL_ID_REDACTED');
  });

  it('shows the detail and decides with 200; a rejection needs its note', async () => {
    gateway.identity.ownerReview.handlers.getRegistration = () =>
      Promise.resolve({ registration: admin });
    gateway.identity.ownerReview.handlers.approveRegistration = () =>
      Promise.resolve({ registration: admin });
    const review = staff(['owner_registration.read', 'owner_registration.review']);
    const detail = await call('get', `/admin/owner-registrations/${registrationId}`, review);
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({
      nationalIdLast4: '1234',
      internalNote: 'Called the number.',
      applicant: { email: 'an@example.com', emailVerified: true, deactivated: false },
      priorApplications: [],
    });

    const approved = await call(
      'post',
      `/admin/owner-registrations/${registrationId}/approve`,
      review,
    ).send({ decisionNote: 'Welcome.', internalNote: 'Checked.' });
    expect(approved.status).toBe(200);
    expect(approved.body.data.registration.id).toBe(registrationId);
    expect(gateway.identity.ownerReview.calls[1]!.request).toEqual({
      registrationId,
      decisionNote: 'Welcome.',
      internalNote: 'Checked.',
    });

    const noNote = await call(
      'post',
      `/admin/owner-registrations/${registrationId}/reject`,
      review,
    ).send({});
    expect(noNote.status).toBe(400);
    expect(gateway.identity.ownerReview.calls).toHaveLength(2);
  });
});
