import { newId, SessionRevokedReason } from '@wayfare/contracts';
import type { IDENTITY_SESSION_REVOKED } from '@wayfare/contracts';
import type { EventPayload } from '@wayfare/contracts';
import {
  CUTOFF_REJECT_ALL,
  raiseTokenCutoff,
  revokedFamilyKey,
  tokenCutoffKey,
} from '@wayfare/nest-common';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { RevocationConsumer } from '../../src/modules/revocation/revocation.consumer';
import { testConfig } from '../setup/database';

const redis = new Redis(testConfig().get('REDIS_URL', { infer: true }), {
  maxRetriesPerRequest: 1,
});
const consumer = new RevocationConsumer(redis, { cutoffMs: 60_000, familyMs: 300 });

afterAll(() => redis.quit());

function event(
  overrides: Partial<EventPayload<typeof IDENTITY_SESSION_REVOKED>>,
): EventPayload<typeof IDENTITY_SESSION_REVOKED> {
  return {
    eventId: newId(),
    occurredAt: new Date().toISOString(),
    userId: newId(),
    familyIds: null,
    tokensValidAfter: null,
    reason: SessionRevokedReason.LOGOUT_ALL,
    ...overrides,
  };
}

describe('revocation consumer', () => {
  it('never lowers a newer cutoff when an older one is redelivered', async () => {
    const userId = newId();
    await consumer.handle(event({ userId, tokensValidAfter: '2026-09-17T10:00:00.000Z' }));
    await consumer.handle(event({ userId, tokensValidAfter: '2026-09-17T09:00:00.000Z' }));
    expect(await redis.get(tokenCutoffKey(userId))).toBe(
      String(Date.parse('2026-09-17T10:00:00.000Z')),
    );
    expect(await redis.pttl(tokenCutoffKey(userId))).toBeGreaterThan(0);
  });

  it('never lowers the reject-all sentinel with a 0', async () => {
    const userId = newId();
    await raiseTokenCutoff(redis, userId, CUTOFF_REJECT_ALL);
    expect(await raiseTokenCutoff(redis, userId, 0)).toBe(CUTOFF_REJECT_ALL);
  });

  it("ends with the consumer's value when the gateway's miss-fill races it", async () => {
    const userId = newId();
    const newer = Date.now();
    // The gateway read "no cutoff" from the database before the logout-all committed…
    const fill = raiseTokenCutoff(redis, userId, 0);
    const consumed = consumer.handle(
      event({ userId, tokensValidAfter: new Date(newer).toISOString() }),
    );
    await Promise.all([fill, consumed]);
    // …and whichever lands last, the stored value is the consumer's.
    await raiseTokenCutoff(redis, userId, 0);
    expect(Number(await redis.get(tokenCutoffKey(userId)))).toBe(newer);
  });

  it('marks each family, and the marker expires', async () => {
    const [a, b] = [newId(), newId()];
    await consumer.handle(event({ familyIds: [a, b], reason: SessionRevokedReason.LOGOUT }));
    expect(await redis.mget(revokedFamilyKey(a), revokedFamilyKey(b))).toEqual(['1', '1']);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(await redis.get(revokedFamilyKey(a))).toBeNull();
  });
});
