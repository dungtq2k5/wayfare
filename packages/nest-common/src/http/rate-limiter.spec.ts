import { describe, expect, it } from 'vitest';
import { FakeRedis } from '../testing/fake-redis';
import { RateLimiter, rateLimitIp, rateLimitKey } from './rate-limiter';

describe('the IP a bucket counts', () => {
  it('keeps IPv4 whole, also as the dual-stack socket reports it', () => {
    expect(rateLimitIp('203.0.113.7')).toBe('203.0.113.7');
    expect(rateLimitIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(rateLimitIp('::FFFF:cb00:7107')).toBe('203.0.113.7');
    // Two mapped callers are two buckets, never the one `/64` they all share.
    expect(rateLimitIp('::ffff:198.51.100.1')).not.toBe(rateLimitIp('::ffff:198.51.100.2'));
  });

  it('keys IPv6 by its /64', () => {
    const one = rateLimitIp('2001:db8:aa:1:abcd::1');
    expect(one).toBe('2001:db8:aa:1::/64');
    expect(rateLimitIp('2001:db8:aa:1:ffff:ffff:ffff:ffff')).toBe(one);
    expect(rateLimitIp('2001:db8:aa:2::1')).not.toBe(one);
    expect(rateLimitIp('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(rateLimitIp('::1')).toBe('0:0:0:0::/64');
  });

  it('is the key of every IP bucket', () => {
    expect(rateLimitKey('PUBLIC_READ', 'ip', '::ffff:127.0.0.1')).toBe(
      'rl:PUBLIC_READ:ip:127.0.0.1',
    );
  });
});

describe('the limiter', () => {
  const setup = () => {
    const redis = new FakeRedis();
    return { redis, limiter: new RateLimiter(redis) };
  };

  it('counts every bucket that applies, or none: a refusal costs nothing', async () => {
    const { redis, limiter } = setup();
    const ip = '203.0.113.7';
    for (let i = 0; i < 10; i++) {
      expect(await limiter.hit('AUTH', { ip, deviceId: 'd1', email: 'a@b.co' })).toMatchObject({
        allowed: true,
      });
    }
    // The device is full: its 11th try is refused, and the shared IP bucket does not move.
    const ipKey = rateLimitKey('AUTH', 'ip', ip);
    expect(redis.values.get(ipKey)).toBe('10');
    expect(await limiter.hit('AUTH', { ip, deviceId: 'd1', email: 'c@d.co' })).toEqual({
      allowed: false,
      retryAfterSeconds: 900,
    });
    expect(redis.values.get(ipKey)).toBe('10');
    // Another guest on the same network still passes.
    expect(await limiter.hit('AUTH', { ip, deviceId: 'd2', email: 'c@d.co' })).toMatchObject({
      allowed: true,
    });
  });

  it('applies the device buckets with a device id, and the stricter IP bucket without', async () => {
    const { limiter } = setup();
    const ip = '198.51.100.9';
    for (let i = 0; i < 10; i++) await limiter.hit('AUTH', { ip, email: `u${i}@b.co` });
    expect(await limiter.hit('AUTH', { ip, email: 'x@b.co' })).toMatchObject({ allowed: false });
    // With a device, the same network has a ceiling of 30.
    expect(await limiter.hit('AUTH', { ip, deviceId: 'd', email: 'x@b.co' })).toMatchObject({
      allowed: true,
    });
  });

  it('gives back what a request counted', async () => {
    const { redis, limiter } = setup();
    const verdict = await limiter.hit('AUTH_LOGIN', {
      ip: '192.0.2.1',
      deviceId: 'd',
      email: 'a@b.co',
    });
    if (!verdict.allowed) throw new Error('refused');
    expect(verdict.counted).toHaveLength(3);
    await limiter.refund(verdict.counted);
    expect(redis.values.size).toBe(0);
  });
});
