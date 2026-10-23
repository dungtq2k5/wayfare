// Continue with Google at the edge (ADRs 0062–0064): the routes, their markers and rate classes,
// the outcome in the session body, the password-or-confirmation bodies, and the dev route that only
// the fake issuer mounts.
import { status } from '@grpc/grpc-js';
import { compareStrings, newId } from '@wayfare/contracts';
import { identityGrpc } from '@wayfare/contracts/grpc';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountToken, bootGateway, deviceToken, serviceError, stubSession } from '../support/app';
import type { E2eApp } from '../support/app';

let gateway: E2eApp;
const server = () => gateway.app.getHttpServer();

beforeAll(async () => {
  gateway = await bootGateway();
});
afterAll(() => gateway.app.close());
beforeEach(() => {
  gateway.identity.reset();
  gateway.redis.values.clear();
});

const mobile = (path: string, bearer?: string) => {
  const req = request(server()).post(path).set('X-Wayfare-Client', 'mobile');
  return bearer === undefined ? req : req.set('Authorization', `Bearer ${bearer}`);
};
const googleCounts = () =>
  [...gateway.redis.values.keys()].filter((key) => key.startsWith('rl:AUTH_LOGIN:'));

describe('POST /auth/google', () => {
  it('answers the session and what the sign-in did', async () => {
    gateway.identity.auth.handlers.googleSignIn = () =>
      Promise.resolve({
        session: stubSession(),
        outcome: identityGrpc.GoogleOutcome.GOOGLE_OUTCOME_LINKED_PASSWORD_REMOVED,
      });
    const res = await mobile('/api/v1/auth/google', deviceToken()).send({
      idToken: 'id.token.value',
      preferredLocale: 'en',
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ outcome: 'LINKED_PASSWORD_REMOVED' });
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    // A successful sign-in leaves nothing counted.
    expect(googleCounts()).toEqual([]);
  });

  it('keeps a refused token counted, and gives back an unreachable Google', async () => {
    gateway.identity.auth.handlers.googleSignIn = () =>
      Promise.reject(
        serviceError(status.UNAUTHENTICATED, {
          'wf-error-code': 'INVALID_GOOGLE_TOKEN',
          'wf-error-details': JSON.stringify({ reason: 'NONCE' }),
        }),
      );
    const refused = await mobile('/api/v1/auth/google', deviceToken()).send({
      idToken: 'x',
      preferredLocale: 'en',
    });
    expect(refused.status).toBe(401);
    expect(refused.body.error).toMatchObject({
      code: 'INVALID_GOOGLE_TOKEN',
      details: { reason: 'NONCE' },
    });
    expect(googleCounts()).toHaveLength(2); // the device and the network; no email in this body

    gateway.redis.values.clear();
    gateway.identity.auth.handlers.googleSignIn = () =>
      Promise.reject(serviceError(status.UNAVAILABLE, { 'wf-error-code': 'GOOGLE_UNAVAILABLE' }));
    const down = await mobile('/api/v1/auth/google', deviceToken()).send({
      idToken: 'x',
      preferredLocale: 'en',
    });
    expect(down.status).toBe(503);
    expect(googleCounts()).toEqual([]);
  });

  it('passes the password step’s ticket through', async () => {
    gateway.identity.auth.handlers.googleSignIn = () =>
      Promise.reject(
        serviceError(status.FAILED_PRECONDITION, {
          'wf-error-code': 'GOOGLE_LINK_NEEDS_PASSWORD',
          'wf-error-details': JSON.stringify({ linkTicket: 'ticket' }),
        }),
      );
    const res = await mobile('/api/v1/auth/google', deviceToken()).send({
      idToken: 'x',
      preferredLocale: 'en',
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'GOOGLE_LINK_NEEDS_PASSWORD',
      details: { linkTicket: 'ticket' },
    });
  });
});

describe('the other Google routes', () => {
  it("give a phone's nonce to its device, with no cookie", async () => {
    gateway.identity.auth.handlers.googleNonce = () => Promise.resolve({ nonce: 'n-1' });
    const res = await mobile('/api/v1/auth/google/nonce', deviceToken());
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ nonce: 'n-1' });
    expect(gateway.identity.auth.calls.at(-1)?.request).toEqual({});
    expect(res.headers['set-cookie']).toBeUndefined();
    // Without a device, identity has nothing to bind it to: its 401 is the answer.
    gateway.identity.auth.handlers.googleNonce = () =>
      Promise.reject(serviceError(status.UNAUTHENTICATED, { 'wf-error-code': 'UNAUTHENTICATED' }));
    expect((await mobile('/api/v1/auth/google/nonce')).status).toBe(401);
  });

  it("bind the console's nonce to wf_gn, send it back with the token, and clear it", async () => {
    gateway.identity.auth.handlers.googleNonce = () => Promise.resolve({ nonce: 'n-2' });
    const issued = await request(server())
      .post('/api/v1/auth/google/nonce')
      .set('X-Wayfare-Client', 'console');
    expect(issued.status).toBe(200);
    const binding = (gateway.identity.auth.calls.at(-1)?.request as { binding: string }).binding;
    expect(binding).toMatch(/^[\w-]{43}$/);
    const [cookie] = issued.headers['set-cookie'] as unknown as string[];
    expect(cookie).toContain(`wf_gn=${binding}`);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth\/google;.*HttpOnly; Secure; SameSite=Lax/);
    expect(cookie).toContain('Max-Age=300');

    gateway.identity.auth.handlers.googleSignIn = () =>
      Promise.resolve({
        session: stubSession(),
        outcome: identityGrpc.GoogleOutcome.GOOGLE_OUTCOME_SIGNED_IN,
      });
    const signedIn = await request(server())
      .post('/api/v1/auth/google')
      .set('X-Wayfare-Client', 'console')
      .set('Cookie', `wf_gn=${binding}`)
      .send({ idToken: 'id.token.value', preferredLocale: 'vi' });
    expect(signedIn.status).toBe(200);
    expect(gateway.identity.auth.calls.at(-1)?.request).toMatchObject({ binding });
    const cookies = signedIn.headers['set-cookie'] as unknown as string[];
    expect(cookies.find((line) => line.startsWith('wf_gn='))).toMatch(
      /^wf_gn=;.*Expires=Thu, 01 Jan 1970/,
    );
  });

  it("count the console's nonces per network", async () => {
    gateway.identity.auth.handlers.googleNonce = () => Promise.resolve({ nonce: 'n' });
    await request(server()).post('/api/v1/auth/google/nonce').set('X-Wayfare-Client', 'console');
    await mobile('/api/v1/auth/google/nonce', deviceToken());
    const counted = [...gateway.redis.values.keys()].filter((key) =>
      key.startsWith('rl:AUTH_NONCE:'),
    );
    expect(counted.map((key) => key.split(':')[2]!).sort(compareStrings)).toEqual([
      'deviceId',
      'ip',
    ]);
  });

  it('confirm and link for a signed-in phone', async () => {
    gateway.identity.auth.handlers.googleConfirm = () => Promise.resolve({ confirmation: 'proof' });
    gateway.identity.auth.handlers.googleLink = () => Promise.resolve({});
    const phone = accountToken({ deviceId: newId() });
    const confirmed = await mobile('/api/v1/auth/google/confirm', phone).send({ idToken: 'x' });
    expect(confirmed.body.data).toEqual({ confirmation: 'proof' });
    expect((await mobile('/api/v1/auth/google/link', phone).send({ linkTicket: 't' })).status).toBe(
      204,
    );
    expect(gateway.identity.auth.calls.at(-1)?.request).toEqual({ linkTicket: 't' });
  });

  it('take exactly one of the password and a confirmation where a password is asked', async () => {
    gateway.identity.auth.handlers.unlinkGoogle = () => Promise.resolve({});
    const phone = accountToken({ deviceId: newId() });
    const unlink = (body: object) =>
      request(server())
        .delete('/api/v1/users/me/identities/google')
        .set('X-Wayfare-Client', 'mobile')
        .set('Authorization', `Bearer ${phone}`)
        .send(body);
    expect((await unlink({ confirmation: 'proof' })).status).toBe(204);
    expect(gateway.identity.auth.calls.at(-1)?.request).toEqual({
      currentPassword: '',
      confirmation: 'proof',
    });
    expect((await unlink({})).status).toBe(400);
    expect((await unlink({ currentPassword: 'p', confirmation: 'proof' })).status).toBe(400);
    const erase = await request(server())
      .delete('/api/v1/users/me')
      .set('X-Wayfare-Client', 'mobile')
      .set('Authorization', `Bearer ${phone}`)
      .send({ confirm: 'DELETE' });
    expect(erase.status).toBe(400);
  });
});

describe('POST /dev/google-token', () => {
  it('asks identity’s fake issuer when the stack runs it', async () => {
    gateway.identity.auth.handlers.mintFakeGoogleToken = () => Promise.resolve({ idToken: 'fake' });
    const res = await mobile('/api/v1/dev/google-token').send({
      email: 'mai@gmail.com',
      nonce: 'n-1',
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ idToken: 'fake' });
    expect(gateway.identity.auth.calls.at(-1)?.request).toMatchObject({ emailVerified: true });
  });

  it('is not there with Google’s own issuer', async () => {
    const real = await bootGateway({ GOOGLE_ISSUER: 'google' });
    try {
      const res = await request(real.app.getHttpServer())
        .post('/api/v1/dev/google-token')
        .set('X-Wayfare-Client', 'mobile')
        .send({ email: 'mai@gmail.com', nonce: 'n-1' });
      expect(res.status).toBe(404);
    } finally {
      await real.app.close();
    }
  });
});
