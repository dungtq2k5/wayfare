import { describe, expect, it, vi } from 'vitest';
import { READINESS_CHECK_TIMEOUT_MS, ReadinessService } from './readiness';

describe('ReadinessService', () => {
  it('is ready only when every declared dependency answers', async () => {
    const service = new ReadinessService([
      { name: 'database', check: () => Promise.resolve() },
      { name: 'nats', check: () => Promise.reject(new Error('connection closed')) },
    ]);
    expect(await service.check()).toEqual({
      ready: false,
      checks: { database: { ok: true }, nats: { ok: false, error: 'connection closed' } },
    });
  });

  it('treats a HUNG dependency as not ready instead of hanging the probe', async () => {
    vi.useFakeTimers();
    const service = new ReadinessService([
      { name: 'redis', check: () => new Promise(() => undefined) },
    ]);
    const pending = service.check();
    await vi.advanceTimersByTimeAsync(READINESS_CHECK_TIMEOUT_MS + 1);
    const report = await pending;
    vi.useRealTimers();
    expect(report.ready).toBe(false);
    expect(report.checks.redis?.error).toMatch(/timed out/);
  });
});
