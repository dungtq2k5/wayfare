import { newId } from '@wayfare/contracts';
import type { Request } from 'express';
import { beforeEach, describe, expect, it } from 'vitest';
import { authStateOf } from '../http/request-context';
import type { RequestAuthState } from '../http/request-context';
import { FakeRedis } from '../testing/fake-redis';
import { signJws } from './jws';
import { generateEncodedSigningKeys, zPrivateKeyEnv, zPublicKeysEnv } from './keys';
import { CUTOFF_REJECT_ALL, revokedFamilyKey, tokenCutoffKey } from './redis-keys';
import { createRequestContextMiddleware } from './request-context.middleware';
import type { TokenCutoffSource } from './request-context.middleware';

const keys = generateEncodedSigningKeys('k1');
const privateKey = zPrivateKeyEnv.parse(keys.privateKey);
const publicKeys = zPublicKeysEnv.parse(keys.publicKeys);
const now = new Date('2026-09-17T12:00:00.000Z');

const userId = newId();
const sessionId = newId();
const claimedDevice = newId();
const bearerDevice = newId();

function accountToken(overrides: Record<string, unknown> = {}, at = now): string {
  return signJws(
    {
      typ: 'user',
      sub: userId,
      iatMs: at.getTime(),
      sid: sessionId,
      perms: ['user.read'],
      ov: false,
      ev: true,
      ...overrides,
    },
    { privateKey, keyId: 'k1', ttlMs: 30 * 60_000, now: at },
  ).token;
}

function deviceToken(deviceId = bearerDevice): string {
  return signJws(
    { typ: 'device', sub: deviceId },
    { privateKey, keyId: 'k1', ttlMs: 15 * 60_000, now },
  ).token;
}

class Source implements TokenCutoffSource {
  answer: number | 'not-found' | Error = 0;
  calls = 0;
  getCutoff(): Promise<number | 'not-found'> {
    this.calls += 1;
    return this.answer instanceof Error
      ? Promise.reject(this.answer)
      : Promise.resolve(this.answer);
  }
}

let redis: FakeRedis;
let source: Source;

beforeEach(() => {
  redis = new FakeRedis();
  source = new Source();
});

async function resolve(
  client: string,
  options: { cookie?: string; bearer?: string } = {},
): Promise<RequestAuthState> {
  const headers: Record<string, string> = { 'x-wayfare-client': client, 'user-agent': 'spec/1.0' };
  if (options.cookie !== undefined) headers.cookie = `other=1; wf_at=${options.cookie}`;
  if (options.bearer !== undefined) headers.authorization = `Bearer ${options.bearer}`;
  const request = {
    ip: '203.0.113.9',
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
  const middleware = createRequestContextMiddleware({
    publicKeys,
    redis,
    cutoffSource: source,
    now: () => now,
  });
  await new Promise<void>((done, fail) => {
    middleware(request, {} as never, (error?: unknown) =>
      error ? fail(error instanceof Error ? error : new Error('middleware failed')) : done(),
    );
  });
  return authStateOf(request);
}

describe('request-context middleware', () => {
  it('resolves a valid console cookie to an account, filling a cutoff miss', async () => {
    const state = await resolve('console', { cookie: accountToken() });
    expect(state).toEqual({
      context: {
        kind: 'account',
        userId,
        sessionId,
        deviceId: null,
        permissions: ['user.read'],
        ownerVerified: false,
        emailVerified: true,
        origin: { ip: '203.0.113.9', userAgent: 'spec/1.0' },
      },
      authError: null,
    });
    expect(source.calls).toBe(1);
    expect(redis.values.get(tokenCutoffKey(userId))).toBe('0');
    await resolve('console', { cookie: accountToken() });
    expect(source.calls).toBe(1); // the second request hits the cache
  });

  it('ignores a console bearer — the cookie is the only console credential', async () => {
    const state = await resolve('console', { bearer: accountToken() });
    expect(state).toMatchObject({ context: { kind: 'anonymous' }, authError: null });
  });

  it("uses the token's did, and the device bearer only when the token has none", async () => {
    const withDid = await resolve('web', {
      cookie: accountToken({ did: claimedDevice }),
      bearer: deviceToken(),
    });
    expect(withDid.context).toMatchObject({ kind: 'account', deviceId: claimedDevice });
    const withoutDid = await resolve('web', { cookie: accountToken(), bearer: deviceToken() });
    expect(withoutDid.context).toMatchObject({ kind: 'account', deviceId: bearerDevice });
  });

  it('accepts a mobile account bearer', async () => {
    const state = await resolve('mobile', { bearer: accountToken({ did: claimedDevice }) });
    expect(state.context).toMatchObject({ kind: 'account', deviceId: claimedDevice });
  });

  it('rejects a token issued before the cutoff, or of a signed-out family', async () => {
    redis.values.set(tokenCutoffKey(userId), String(now.getTime() + 1));
    expect(await resolve('console', { cookie: accountToken() })).toMatchObject({
      context: { kind: 'anonymous' },
      authError: 'revoked',
    });
    redis.values.set(tokenCutoffKey(userId), String(now.getTime()));
    expect((await resolve('console', { cookie: accountToken() })).context.kind).toBe('account');
    redis.values.set(revokedFamilyKey(sessionId), '1');
    expect((await resolve('console', { cookie: accountToken() })).authError).toBe('revoked');
  });

  it('rejects every token of an unknown user, for good', async () => {
    source.answer = 'not-found';
    expect((await resolve('console', { cookie: accountToken() })).authError).toBe('revoked');
    expect(redis.values.get(tokenCutoffKey(userId))).toBe(String(CUTOFF_REJECT_ALL));
  });

  it('falls back to the device context when the account token is rejected', async () => {
    redis.values.set(revokedFamilyKey(sessionId), '1');
    const state = await resolve('web', { cookie: accountToken(), bearer: deviceToken() });
    expect(state).toMatchObject({
      context: { kind: 'device', deviceId: bearerDevice },
      authError: 'revoked',
    });
  });

  it('is unverifiable — never a pass — when Redis or identity cannot answer', async () => {
    source.answer = new Error('identity down');
    expect(await resolve('console', { cookie: accountToken() })).toMatchObject({
      context: { kind: 'anonymous' },
      authError: 'unverifiable',
    });
    redis.failure = new Error('redis down');
    const withDevice = await resolve('web', { cookie: accountToken(), bearer: deviceToken() });
    expect(withDevice).toMatchObject({ context: { kind: 'device' }, authError: 'unverifiable' });
  });

  it('never checks revocation for a device token', async () => {
    redis.failure = new Error('redis down');
    expect(await resolve('mobile', { bearer: deviceToken() })).toMatchObject({
      context: { kind: 'device', deviceId: bearerDevice },
      authError: null,
    });
  });

  it('marks an invalid token and continues as anonymous', async () => {
    expect(await resolve('console', { cookie: 'garbage' })).toMatchObject({
      context: { kind: 'anonymous' },
      authError: 'invalid',
    });
    expect(await resolve('web', { bearer: 'garbage' })).toMatchObject({ authError: 'invalid' });
    expect(
      await resolve('mobile', { bearer: accountToken({}, new Date(now.getTime() - 3_600_000)) }),
    ).toMatchObject({
      authError: 'invalid',
    });
  });

  it('is anonymous with no token, and with an unknown client', async () => {
    expect(await resolve('mobile')).toMatchObject({
      context: { kind: 'anonymous' },
      authError: null,
    });
    expect(await resolve('fridge', { bearer: accountToken() })).toMatchObject({
      context: { kind: 'anonymous' },
    });
  });
});
