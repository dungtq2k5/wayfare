// The gateway's rate-limit scripts against a real Redis: the gateway's own e2e suite runs on an
// in-memory stand-in, and this suite is the one with a Redis (as for the revocation scripts).
import { newId } from '@wayfare/contracts';
import { RateLimiter, rateLimitKey } from '@wayfare/nest-common';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { testConfig } from '../setup/database';

const redis = new Redis(testConfig().get('REDIS_URL', { infer: true }), {
  maxRetriesPerRequest: 1,
});
const limiter = new RateLimiter(redis);

afterAll(() => redis.quit());

/** A network of its own per call — a fresh IPv6 `/64` — so runs never meet each other's counts. */
const network = () => {
  const hex = newId().replaceAll('-', '');
  return `2001:db8:${hex.slice(-8, -4)}:${hex.slice(-4)}::1`;
};

describe('the rate-limit script', () => {
  it('counts nothing for a refused request, and waits for the longest full window', async () => {
    const ip = network();
    const device = newId();
    for (let i = 0; i < 10; i++) {
      await limiter.hit('AUTH', { ip, deviceId: device, email: `${newId()}@example.com` });
    }
    const ipKey = rateLimitKey('AUTH', 'ip', ip);
    expect(await redis.get(ipKey)).toBe('10');
    const refused = await limiter.hit('AUTH', { ip, deviceId: device, email: 'x@example.com' });
    expect(refused).toMatchObject({ allowed: false });
    expect(await redis.get(ipKey)).toBe('10');
    expect(await redis.get(rateLimitKey('AUTH', 'email', 'x@example.com'))).toBeNull();
    // The device's window: up to 15 minutes, whole seconds.
    if (refused.allowed) throw new Error('allowed');
    expect(refused.retryAfterSeconds).toBeGreaterThan(890);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(900);
    expect(await redis.pttl(ipKey)).toBeGreaterThan(0);
  });

  it('gives back a counted attempt, leaving no key behind', async () => {
    const ip = network();
    const email = `${newId()}@example.com`;
    const verdict = await limiter.hit('AUTH_LOGIN', { ip, deviceId: newId(), email });
    if (!verdict.allowed) throw new Error('refused');
    await limiter.refund(verdict.counted);
    for (const key of verdict.counted) expect(await redis.exists(key)).toBe(0);
  });

  it('lets at most the limit through when guesses arrive together', async () => {
    const email = `${newId()}@example.com`;
    const answers = await Promise.all(
      Array.from({ length: 20 }, () =>
        limiter.hit('AUTH_LOGIN', { ip: network(), deviceId: newId(), email }),
      ),
    );
    expect(answers.filter((answer) => answer.allowed)).toHaveLength(10);
    expect(await redis.get(rateLimitKey('AUTH_LOGIN', 'email', email))).toBe('10');
  });
});
