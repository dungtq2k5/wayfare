import { identityGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountToken, bootGateway, stubSession } from '../support/app';
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
