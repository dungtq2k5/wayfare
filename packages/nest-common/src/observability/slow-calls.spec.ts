import { Logger } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, Observable, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SLOW_CALL_MS, SlowCallInterceptor } from './slow-calls';

class PlaceQueries {
  getPlaceByCode(): void {}
}

const rpc = (type = 'rpc') =>
  ({
    getType: () => type,
    getClass: () => PlaceQueries,
    getHandler: () => PlaceQueries.prototype.getPlaceByCode,
  }) as unknown as ExecutionContext;

/** A handler that takes `ms` by the clock the interceptor reads. */
function taking(ms: number): CallHandler {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  return {
    handle: () => {
      now += ms;
      return of('answer');
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('SlowCallInterceptor', () => {
  it('says where a slow gRPC call spent its time', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const answer = await firstValueFrom(
      new SlowCallInterceptor().intercept(rpc(), taking(SLOW_CALL_MS + 500)),
    );
    expect(answer).toBe('answer');
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'PlaceQueries.getPlaceByCode',
        totalMs: 1_500,
        poolWaitMs: 0,
        queryMs: 0,
        otherMs: 1_500,
        outcome: 'answered',
      }),
      'slow call: PlaceQueries.getPlaceByCode answered after 1500 ms',
    );
  });

  it('reports a call its caller cancelled, when it gives up', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const never = new SlowCallInterceptor()
      .intercept(rpc(), { handle: () => new Observable(() => undefined) })
      .subscribe();
    now = 2_000;
    never.unsubscribe();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'cancelled', totalMs: 2_000 }),
      'slow call: PlaceQueries.getPlaceByCode cancelled after 2000 ms',
    );
  });

  it('is quiet for a quick call, and for anything but gRPC', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await firstValueFrom(new SlowCallInterceptor().intercept(rpc(), taking(SLOW_CALL_MS - 1)));
    await firstValueFrom(new SlowCallInterceptor().intercept(rpc('http'), taking(5_000)));
    expect(warn).not.toHaveBeenCalled();
  });
});
