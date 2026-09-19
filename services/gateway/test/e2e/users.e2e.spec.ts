import { status } from '@grpc/grpc-js';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountToken, bootGateway, serviceError, stubSession } from '../support/app';
import type { E2eApp } from '../support/app';

let gateway: E2eApp;
const server = () => gateway.app.getHttpServer();
const cookie = () => `wf_at=${accountToken({ ev: false })}`;

beforeAll(async () => {
  gateway = await bootGateway();
});

afterAll(() => gateway.app.close());

beforeEach(() => {
  gateway.identity.reset();
  gateway.redis.values.clear();
  const { user } = stubSession();
  gateway.identity.users.handlers.getMe = () =>
    Promise.resolve({ user, roles: ['USER'], permissions: [], ownerVerified: false });
  gateway.identity.users.handlers.updateMe = () =>
    Promise.resolve({ user: { ...user!, fullName: undefined } });
  gateway.identity.users.handlers.listLegalAcceptances = () =>
    Promise.resolve({
      acceptances: [
        {
          party: identityGrpc.LegalParty.LEGAL_PARTY_USER,
          document: identityGrpc.LegalDocument.LEGAL_DOCUMENT_TERMS_OF_SERVICE,
          version: '2025-01-01',
          acceptedAt: toProtoTimestamp(new Date('2025-01-02T00:00:00.000Z')),
          current: false,
        },
      ],
    });
});

describe('/users/me', () => {
  it('bootstraps the console: 200, private, never cached', async () => {
    const res = await request(server())
      .get('/api/v1/users/me')
      .set('X-Wayfare-Client', 'console')
      .set('Cookie', cookie());
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      roles: ['USER'],
      permissions: [],
      ownerVerified: false,
      user: { email: 'ann@example.com' },
    });
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it("carries an applicant's open application, and null for everyone else", async () => {
    const plain = await request(server())
      .get('/api/v1/users/me')
      .set('X-Wayfare-Client', 'console')
      .set('Cookie', cookie());
    expect(plain.body.data.owner).toBeNull();
    const { user } = stubSession();
    gateway.identity.users.handlers.getMe = () =>
      Promise.resolve({
        user,
        roles: ['USER'],
        permissions: [],
        ownerVerified: false,
        owner: {
          pendingRegistration: {
            id: '01990000-0000-7000-8000-0000000000aa',
            submittedAt: toProtoTimestamp(new Date('2026-09-18T08:00:00.000Z')),
          },
        },
      });
    const res = await request(server())
      .get('/api/v1/users/me')
      .set('X-Wayfare-Client', 'console')
      .set('Cookie', cookie());
    expect(res.body.data.owner).toEqual({
      pendingRegistration: {
        id: '01990000-0000-7000-8000-0000000000aa',
        submittedAt: '2026-09-18T08:00:00.000Z',
      },
      // An applicant is not an owner yet: billing is not asked.
      billingSummary: null,
    });
    expect(gateway.billing.billing.calls).toHaveLength(0);
  });

  it('refuses anonymous callers', async () => {
    const res = await request(server()).get('/api/v1/users/me').set('X-Wayfare-Client', 'console');
    expect(res.status).toBe(401);
  });

  it('updates the name and language, mapping an absent name to null', async () => {
    const res = await request(server())
      .patch('/api/v1/users/me')
      .set('X-Wayfare-Client', 'console')
      .set('Cookie', cookie())
      .send({ preferredLocale: 'vi' });
    expect(res.status).toBe(200);
    expect(res.body.data.user.fullName).toBeNull();
    expect(gateway.identity.users.calls[0]?.request).toEqual({ preferredLocale: 'vi' });
    const refused = await request(server())
      .patch('/api/v1/users/me')
      .set('X-Wayfare-Client', 'console')
      .set('Cookie', cookie())
      .send({ email: 'x@y.z' });
    expect(refused.status).toBe(400);
  });

  it('lists acceptances as a bare array with their current flag', async () => {
    const res = await request(server())
      .get('/api/v1/users/me/legal-acceptances')
      .set('X-Wayfare-Client', 'web')
      .set('Cookie', cookie());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [
        {
          party: 'USER',
          document: 'TERMS_OF_SERVICE',
          version: '2025-01-01',
          acceptedAt: '2025-01-02T00:00:00.000Z',
          current: false,
        },
      ],
    });
  });
});

describe('DELETE /users/me', () => {
  const erase = (body: unknown) =>
    request(server())
      .delete('/api/v1/users/me')
      .set('X-Wayfare-Client', 'console')
      .set('Cookie', cookie())
      .send(body as object);
  const cookiesOf = (res: request.Response) =>
    (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];

  it('parses the JSON body, forwards the password only, answers 204 and clears the cookies', async () => {
    gateway.identity.users.handlers.eraseMe = () => Promise.resolve({});
    const res = await erase({ currentPassword: 'correct horse battery', confirm: 'DELETE' });
    expect(res.status).toBe(204);
    expect(gateway.identity.users.calls.at(-1)).toMatchObject({
      method: 'eraseMe',
      request: { currentPassword: 'correct horse battery' },
    });
    expect(cookiesOf(res).some((c) => c.startsWith('wf_at=;'))).toBe(true);
    expect(cookiesOf(res).some((c) => c.startsWith('wf_rt=;'))).toBe(true);
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('refuses anything but the word DELETE, without asking identity', async () => {
    for (const body of [
      { currentPassword: 'x', confirm: 'delete' },
      { currentPassword: 'x' },
      { confirm: 'DELETE' },
    ]) {
      const res = await erase(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    }
    expect(gateway.identity.users.calls.filter((call) => call.method === 'eraseMe')).toEqual([]);
  });

  it("maps identity's refusals and keeps the cookies", async () => {
    const refusals: [string, number, number, Record<string, string>?][] = [
      ['INVALID_CREDENTIALS', status.UNAUTHENTICATED, 401],
      ['EMAIL_CHANGE_REVERT_PENDING', status.FAILED_PRECONDITION, 409],
      ['LAST_SUPER_ADMIN', status.FAILED_PRECONDITION, 409],
      ['BUYER_HAS_PENDING_ORDER', status.FAILED_PRECONDITION, 409],
      [
        'OWNER_HAS_ACTIVE_OBLIGATIONS',
        status.FAILED_PRECONDITION,
        409,
        { subscriptionEndsAt: '2026-10-19T10:00:00.000Z' },
      ],
      ['UPSTREAM_UNAVAILABLE', status.UNAVAILABLE, 503],
    ];
    for (const [code, grpcStatus, http, details] of refusals) {
      gateway.identity.users.handlers.eraseMe = () =>
        Promise.reject(
          serviceError(grpcStatus, {
            'wf-error-code': code,
            ...(details === undefined ? {} : { 'wf-error-details': JSON.stringify(details) }),
          }),
        );
      const res = await erase({ currentPassword: 'x', confirm: 'DELETE' });
      expect(res.status, code).toBe(http);
      expect(res.body.error.code).toBe(code);
      if (details !== undefined) expect(res.body.error.details).toEqual(details);
      expect(cookiesOf(res).some((c) => c.startsWith('wf_at=;'))).toBe(false);
    }
  });
});
