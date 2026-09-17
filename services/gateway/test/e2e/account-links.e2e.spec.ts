import { status } from '@grpc/grpc-js';
import { newId } from '@wayfare/contracts';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { FIXTURE_TIMESTAMP } from '@wayfare/contracts/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountToken, bootGateway, serviceError } from '../support/app';
import type { E2eApp } from '../support/app';

let gateway: E2eApp;
const server = () => gateway.app.getHttpServer();
const userId = newId();
const signedIn = () => `wf_at=${accountToken({ userId, perms: ['user.read'] })}`;
const TOKEN = 'a'.repeat(43);

type Method = 'post' | 'patch';

function consoleRequest(method: Method, path: string, cookie?: string) {
  const agent = request(server());
  const req = agent[method](`/api/v1${path}`).set('X-Wayfare-Client', 'console');
  return cookie === undefined ? req : req.set('Cookie', cookie);
}

function cookiesOf(res: request.Response): string[] {
  return (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
}

const rateKeys = (cls: string) =>
  [...gateway.redis.values.keys()].filter((key) => key.startsWith(`rl:${cls}:`));

beforeAll(async () => {
  gateway = await bootGateway();
});

afterAll(() => gateway.app.close());

beforeEach(() => {
  gateway.identity.reset();
  gateway.redis.values.clear();
  const ok = () => Promise.resolve({});
  const { passwords, emailChange, emailWebhooks, adminUsers } = gateway.identity;
  for (const method of ['requestPasswordReset', 'completePasswordReset', 'changePassword']) {
    passwords.handlers[method] = ok;
  }
  passwords.handlers.validateResetToken = () =>
    Promise.resolve({
      purpose: identityGrpc.ActionTokenPurpose.ACTION_TOKEN_PURPOSE_ACCOUNT_SETUP,
      emailMasked: 'a***e@example.com',
    });
  for (const method of [
    'requestEmailVerification',
    'verifyEmail',
    'requestEmailChange',
    'confirmEmailChange',
    'revertEmailChange',
  ]) {
    emailChange.handlers[method] = ok;
  }
  emailWebhooks.handlers.receiveResendEvent = ok;
  adminUsers.handlers.listEmailDeliveries = () =>
    Promise.resolve({
      deliveries: [
        {
          id: newId(),
          template: identityGrpc.EmailTemplate.EMAIL_TEMPLATE_PASSWORD_RESET,
          toEmailMasked: 'a***e@example.com',
          status: identityGrpc.EmailDeliveryStatus.EMAIL_DELIVERY_STATUS_BOUNCED,
          bounceType: identityGrpc.EmailBounceType.EMAIL_BOUNCE_TYPE_HARD,
          statusChangedAt: FIXTURE_TIMESTAMP,
          createdAt: FIXTURE_TIMESTAMP,
        },
        {
          id: newId(),
          template: identityGrpc.EmailTemplate.EMAIL_TEMPLATE_EMAIL_VERIFICATION,
          status: identityGrpc.EmailDeliveryStatus.EMAIL_DELIVERY_STATUS_SENT,
          bounceType: identityGrpc.EmailBounceType.EMAIL_BOUNCE_TYPE_UNSPECIFIED,
          statusChangedAt: FIXTURE_TIMESTAMP,
          createdAt: FIXTURE_TIMESTAMP,
        },
      ],
      page: { nextCursor: 'next' },
    });
  adminUsers.handlers.checkEmailDelivery = () => Promise.resolve({ matches: true });
});

/** Every public link route, its success status and a valid body. */
const PUBLIC_ROUTES: [string, number, object][] = [
  ['/auth/password/forgot', 202, { email: 'ann@example.com' }],
  ['/auth/password/reset/validate', 200, { token: TOKEN }],
  ['/auth/password/reset', 204, { token: TOKEN, newPassword: 'a new password' }],
  ['/auth/email/verify', 204, { token: TOKEN }],
  ['/auth/email/change/confirm', 204, { token: TOKEN }],
  ['/auth/email/change/revert', 204, { token: TOKEN }],
];

describe('link routes', () => {
  it.each(PUBLIC_ROUTES)(
    '%s is public, never cached, and bounds its body',
    async (path, code, body) => {
      const res = await consoleRequest('post', path).send(body);
      expect(res.status).toBe(code);
      expect(res.headers['cache-control']).toBe('private, no-store');
      const tooLong = await consoleRequest('post', path).send({ ...body, token: 'x'.repeat(257) });
      expect(tooLong.status).toBe(400);
      const extra = await consoleRequest('post', path).send({ ...body, userId: newId() });
      expect(extra.status).toBe(400);
    },
  );

  it('forgot counts against the AUTH buckets, keyed by IP and address', async () => {
    await consoleRequest('post', '/auth/password/forgot').send({ email: 'Ann@Example.com' });
    expect(rateKeys('AUTH').length).toBe(2);
    expect(gateway.identity.passwords.calls[0]?.request).toEqual({ email: 'ann@example.com' });
  });

  it('validate answers the purpose and the masked address only', async () => {
    const res = await consoleRequest('post', '/auth/password/reset/validate').send({
      token: TOKEN,
    });
    expect(res.body).toEqual({
      data: { valid: true, purpose: 'ACCOUNT_SETUP', emailMasked: 'a***e@example.com' },
    });
  });

  it('an expired link is 410, and a reset or a revert clears the session cookies', async () => {
    gateway.identity.passwords.handlers.validateResetToken = () =>
      Promise.reject(
        serviceError(status.FAILED_PRECONDITION, { 'wf-error-code': 'TOKEN_EXPIRED' }),
      );
    const expired = await consoleRequest('post', '/auth/password/reset/validate').send({
      token: TOKEN,
    });
    expect(expired.status).toBe(410);

    for (const path of ['/auth/password/reset', '/auth/email/change/revert']) {
      const res = await consoleRequest('post', path, signedIn()).send(
        path.endsWith('reset') ? { token: TOKEN, newPassword: 'a new password' } : { token: TOKEN },
      );
      expect(res.status, path).toBe(204);
      const cleared = cookiesOf(res);
      expect(
        cleared.some((c) => c.startsWith('wf_at=;')),
        path,
      ).toBe(true);
      expect(
        cleared.some((c) => c.startsWith('wf_rt=;')),
        path,
      ).toBe(true);
    }
    const verify = await consoleRequest('post', '/auth/email/verify', signedIn()).send({
      token: TOKEN,
    });
    expect(cookiesOf(verify)).toEqual([]);
  });

  it('never forwards a token through the URL', async () => {
    await consoleRequest('post', '/auth/email/verify').send({ token: TOKEN });
    expect(gateway.identity.emailChange.calls[0]?.request).toEqual({ token: TOKEN });
  });
});

describe('signed-in routes', () => {
  it.each([
    [
      'patch',
      '/auth/password',
      204,
      { currentPassword: 'x', newPassword: 'a new password' },
      'PASSWORD_CHECK',
    ],
    [
      'post',
      '/auth/email/change',
      202,
      { newEmail: 'new@example.com', currentPassword: 'x' },
      'PASSWORD_CHECK',
    ],
    ['post', '/auth/email/verify/request', 202, undefined, 'EMAIL_REQUEST'],
  ] as const)('%s %s needs an account and uses %s', async (method, path, code, body, cls) => {
    expect((await consoleRequest(method, path).send(body)).status).toBe(401);
    const res = await consoleRequest(method, path, signedIn()).send(body);
    expect(res.status).toBe(code);
    expect(rateKeys(cls)).toEqual([`rl:${cls}:userId:${userId}`]);
  });

  it('a wrong current password is 403, never 401, and the cookies stay', async () => {
    gateway.identity.passwords.handlers.changePassword = () =>
      Promise.reject(
        serviceError(status.PERMISSION_DENIED, { 'wf-error-code': 'CURRENT_PASSWORD_INCORRECT' }),
      );
    const res = await consoleRequest('patch', '/auth/password', signedIn()).send({
      currentPassword: 'wrong',
      newPassword: 'a new password',
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CURRENT_PASSWORD_INCORRECT');
    expect(cookiesOf(res)).toEqual([]);
  });

  it('refuses a short new password and a malformed address before identity', async () => {
    const short = await consoleRequest('patch', '/auth/password', signedIn()).send({
      currentPassword: 'x',
      newPassword: 'short',
    });
    expect(short.status).toBe(400);
    const address = await consoleRequest('post', '/auth/email/change', signedIn()).send({
      newEmail: 'not-an-address',
      currentPassword: 'x',
    });
    expect(address.status).toBe(400);
    expect(gateway.identity.passwords.calls).toHaveLength(0);
    expect(gateway.identity.emailChange.calls).toHaveLength(0);
  });
});

describe('delivery history', () => {
  const id = newId();

  it('lists deliveries as a cursor page, needing user.read', async () => {
    const noPermission = await request(server())
      .get(`/api/v1/admin/users/${id}/email-deliveries`)
      .set('X-Wayfare-Client', 'console')
      .set('Cookie', `wf_at=${accountToken({ perms: [] })}`);
    expect(noPermission.status).toBe(403);
    const res = await request(server())
      .get(`/api/v1/admin/users/${id}/email-deliveries?limit=2`)
      .set('X-Wayfare-Client', 'console')
      .set('Cookie', signedIn());
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ nextCursor: 'next' });
    expect(res.body.data).toEqual([
      expect.objectContaining({
        template: 'PASSWORD_RESET',
        toEmailMasked: 'a***e@example.com',
        status: 'BOUNCED',
        bounceType: 'HARD',
      }),
      expect.objectContaining({
        template: 'EMAIL_VERIFICATION',
        toEmailMasked: null,
        bounceType: null,
      }),
    ]);
    expect(gateway.identity.adminUsers.calls[0]?.request).toEqual({
      userId: id,
      page: { limit: 2 },
    });
  });

  it('checks a claimed address in a body, under EMAIL_CHECK', async () => {
    const res = await consoleRequest(
      'post',
      `/admin/users/${id}/email-deliveries/check`,
      signedIn(),
    ).send({
      email: ' Claimed@Example.com ',
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { matches: true } });
    expect(gateway.identity.adminUsers.calls[0]?.request).toEqual({
      userId: id,
      email: 'claimed@example.com',
    });
    expect(rateKeys('EMAIL_CHECK')).toEqual([`rl:EMAIL_CHECK:userId:${userId}`]);
    const bad = await consoleRequest(
      'post',
      `/admin/users/${id}/email-deliveries/check`,
      signedIn(),
    ).send({
      email: 'nope',
    });
    expect(bad.status).toBe(400);
  });
});

describe('POST /api/webhooks/resend', () => {
  const body = '{"type":"email.delivered","data":{"email_id":"re_1"}}';

  it('needs no client header, is version-neutral, and forwards the raw bytes and signature headers', async () => {
    const res = await request(server())
      .post('/api/webhooks/resend')
      .set('Content-Type', 'application/json')
      .set('svix-id', 'msg_1')
      .set('svix-timestamp', '1789560000')
      .set('svix-signature', 'v1,abc')
      .send(body);
    expect(res.status).toBe(204);
    const forwarded = gateway.identity.emailWebhooks.calls[0]?.request as {
      rawBody: Buffer;
      svixId: string;
      svixTimestamp: string;
      svixSignature: string;
    };
    expect(forwarded.rawBody.toString('utf8')).toBe(body);
    expect(forwarded).toMatchObject({
      svixId: 'msg_1',
      svixTimestamp: '1789560000',
      svixSignature: 'v1,abc',
    });
    expect([...gateway.redis.values.keys()].filter((key) => key.startsWith('rl:'))).toEqual([]);
  });

  it("passes identity's 401 through, and any other failure as a non-2xx", async () => {
    gateway.identity.emailWebhooks.handlers.receiveResendEvent = () =>
      Promise.reject(serviceError(status.UNAUTHENTICATED, { 'wf-error-code': 'UNAUTHENTICATED' }));
    const refused = await request(server())
      .post('/api/webhooks/resend')
      .set('Content-Type', 'application/json')
      .send(body);
    expect(refused.status).toBe(401);
    gateway.identity.emailWebhooks.handlers.receiveResendEvent = () =>
      Promise.reject(serviceError(status.UNAVAILABLE));
    const down = await request(server())
      .post('/api/webhooks/resend')
      .set('Content-Type', 'application/json')
      .send(body);
    expect(down.status).toBe(503);
    const versioned = await request(server())
      .post('/api/v1/webhooks/resend')
      .set('Content-Type', 'application/json')
      .send(body);
    expect(versioned.status).toBe(404);
  });
});
