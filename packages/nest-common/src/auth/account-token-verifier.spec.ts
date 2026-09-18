import { newId } from '@wayfare/contracts';
import type { AccountClaims } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { FakeRedis } from '../testing/fake-redis';
import { AccountTokenVerifier } from './account-token-verifier';
import type { TokenCutoffSource } from './account-token-verifier';
import { generateEncodedSigningKeys, zPublicKeysEnv } from './keys';
import { revokedFamilyKey, tokenCutoffKey } from './redis-keys';

const publicKeys = zPublicKeysEnv.parse(generateEncodedSigningKeys('k1').publicKeys);
const now = new Date('2026-09-18T12:00:00.000Z');

const claims = (userId: string, sessionId = newId(), iatMs = now.getTime()): AccountClaims =>
  ({ typ: 'user', sub: userId, sid: sessionId, iatMs, perms: [], ov: false, ev: true }) as never;

class CountingRedis extends FakeRedis {
  mgets = 0;
  override mget(...keys: string[]) {
    this.mgets += 1;
    return super.mget(...keys);
  }
}

class Source implements TokenCutoffSource {
  readonly asked: string[] = [];
  failing = false;
  getCutoff(userId: string): Promise<number> {
    this.asked.push(userId);
    return this.failing ? Promise.reject(new Error('identity down')) : Promise.resolve(0);
  }
}

describe('AccountTokenVerifier.checkMany', () => {
  it('reads every key with one MGET, and asks identity only for the misses, once per user', async () => {
    const redis = new CountingRedis();
    const source = new Source();
    const verifier = new AccountTokenVerifier({
      publicKeys,
      redis,
      cutoffSource: source,
      now: () => now,
    });
    const [known, revoked, signedOut] = [newId(), newId(), newId()];
    const missing = newId();
    const signedOutSession = newId();
    redis.values.set(tokenCutoffKey(known), '0');
    redis.values.set(tokenCutoffKey(revoked), String(now.getTime() + 1));
    redis.values.set(tokenCutoffKey(signedOut), '0');
    redis.values.set(revokedFamilyKey(signedOutSession), '1');

    const results = await verifier.checkMany([
      claims(known),
      claims(revoked),
      claims(signedOut, signedOutSession),
      claims(missing),
      claims(missing),
    ]);
    expect(results.map((result) => (result.kind === 'valid' ? 'valid' : result.error))).toEqual([
      'valid',
      'revoked',
      'revoked',
      'valid',
      'valid',
    ]);
    expect(redis.mgets).toBe(1);
    expect(source.asked).toEqual([missing]);
  });

  it('is unverifiable, never a pass, when Redis or identity cannot answer', async () => {
    const redis = new CountingRedis();
    const source = new Source();
    const verifier = new AccountTokenVerifier({
      publicKeys,
      redis,
      cutoffSource: source,
      now: () => now,
    });
    source.failing = true;
    expect(await verifier.check(claims(newId()))).toEqual({
      kind: 'rejected',
      error: 'unverifiable',
    });
    redis.failure = new Error('down');
    expect(await verifier.checkMany([claims(newId()), claims(newId())])).toEqual([
      { kind: 'rejected', error: 'unverifiable' },
      { kind: 'rejected', error: 'unverifiable' },
    ]);
    expect(await verifier.checkMany([])).toEqual([]);
  });
});
