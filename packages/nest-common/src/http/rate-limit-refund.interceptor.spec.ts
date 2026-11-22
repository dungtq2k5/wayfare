import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AppHttpException } from './app-http.exception';
import { RATE_LIMIT_RESERVED } from './rate-limit.guard';
import { RateLimitRefundInterceptor } from './rate-limit-refund.interceptor';
import type { RateLimiter } from './rate-limiter';

function http(reserved?: { keys: string[]; failures: string[] }, type = 'http'): ExecutionContext {
  const request = reserved === undefined ? {} : { [RATE_LIMIT_RESERVED]: reserved };
  return {
    getType: () => type,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const answering = (value: unknown): CallHandler => ({ handle: () => of(value) });
const refusing = (error: unknown): CallHandler => ({ handle: () => throwError(() => error) });

function interceptor(refund = vi.fn(() => Promise.resolve())) {
  return { refund, it: new RateLimitRefundInterceptor({ refund } as unknown as RateLimiter) };
}

const reserved = { keys: ['rl:AUTH:ip'], failures: ['INVALID_CREDENTIALS'] };

describe('a failures-only rate limit (api-endpoints-plan §0.9)', () => {
  it('gives the count back for a success', async () => {
    const { refund, it: refunds } = interceptor();
    expect(await firstValueFrom(refunds.intercept(http(reserved), answering('ok')))).toBe('ok');
    expect(refund).toHaveBeenCalledWith(['rl:AUTH:ip']);
  });

  it('keeps the count for one of the class’s failures, and gives it back for any other refusal', async () => {
    const { refund, it: refunds } = interceptor();
    const guess = new AppHttpException('INVALID_CREDENTIALS');
    await expect(firstValueFrom(refunds.intercept(http(reserved), refusing(guess)))).rejects.toBe(
      guess,
    );
    expect(refund).not.toHaveBeenCalled();
    const malformed = new AppHttpException('VALIDATION_FAILED', { issues: [] });
    await expect(
      firstValueFrom(refunds.intercept(http(reserved), refusing(malformed))),
    ).rejects.toBe(malformed);
    expect(refund).toHaveBeenCalledTimes(1);
  });

  it('answers as it would have when the store refuses the refund', async () => {
    for (const failure of [new Error('redis down'), 'redis down']) {
      const { it: refunds } = interceptor(vi.fn<() => Promise<void>>().mockRejectedValue(failure));
      expect(await firstValueFrom(refunds.intercept(http(reserved), answering('ok')))).toBe('ok');
    }
  });

  it('does nothing for a request nothing was counted for, or that isn’t HTTP', async () => {
    const { refund, it: refunds } = interceptor();
    await firstValueFrom(refunds.intercept(http(), answering(1)));
    await firstValueFrom(refunds.intercept(http({ keys: [], failures: [] }), answering(1)));
    await firstValueFrom(refunds.intercept(http(reserved, 'rpc'), answering(1)));
    expect(refund).not.toHaveBeenCalled();
  });
});
