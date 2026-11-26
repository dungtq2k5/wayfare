import { Logger } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import pg from 'pg';
import { firstValueFrom, from, Observable, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fillPools, SLOW_CALL_MS, SlowCallInterceptor, TimedPool, timedPool } from './slow-calls';

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

describe('TimedPool', () => {
  /** pg's own pool, answering at once: a query takes 300 ms, a connection 200 ms (100 by callback). */
  function fakePg() {
    const clock = { now: 0 };
    vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
    const release = vi.fn();
    const client = { release } as unknown as pg.PoolClient;
    const query = (...args: unknown[]): unknown => {
      if (typeof args.at(-1) === 'function') return undefined;
      return new Promise((resolve) =>
        setTimeout(() => {
          clock.now += 300;
          resolve({ rows: [] });
        }, 0),
      );
    };
    vi.spyOn(pg.Pool.prototype, 'query').mockImplementation(query);
    const connect = vi.spyOn(pg.Pool.prototype, 'connect').mockImplementation(((
      callback?: (error: undefined, client: pg.PoolClient, done: () => void) => void,
    ) => {
      if (callback !== undefined) {
        clock.now += 100;
        callback(undefined, client, () => undefined);
        return undefined;
      }
      clock.now += 200;
      return Promise.resolve(client);
    }) as never);
    return { clock, release, connect };
  }

  it('charges a slow call with its connection waits and its query time', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { clock } = fakePg();
    const pool = new TimedPool({ max: 1 });
    const handler: CallHandler = {
      handle: () =>
        from(
          (async () => {
            await pool.query('SELECT 1');
            await pool.connect();
            await new Promise<void>((resolve) => pool.connect(() => resolve()));
            clock.now += SLOW_CALL_MS;
            return 'answer';
          })(),
        ),
    };
    expect(await firstValueFrom(new SlowCallInterceptor().intercept(rpc(), handler))).toBe(
      'answer',
    );
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        poolWaitMs: 300,
        queryMs: 300,
        queries: 1,
        otherMs: SLOW_CALL_MS,
        inFlight: { waiting: 0, querying: 0 },
      }),
      expect.any(String),
    );
  });

  it('charges nothing outside a gRPC call, and hands a callback query back as pg answers it', async () => {
    fakePg();
    const pool = timedPool('postgres://unused@localhost/none');
    await expect(pool.query('SELECT 1')).resolves.toEqual({ rows: [] });
    expect(pool.query('SELECT 1', () => undefined)).toBeUndefined();
    await expect(pool.connect()).resolves.toBeDefined();
  });

  it('fills every pool with all the connections it may hold, handing them back idle', async () => {
    const { release, connect } = fakePg();
    new TimedPool({ max: 3 });
    await fillPools();
    expect(connect.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(release).toHaveBeenCalledTimes(connect.mock.calls.length);
  });
});
