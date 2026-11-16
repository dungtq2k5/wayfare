import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, Logger } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import pg from 'pg';
import { Observable } from 'rxjs';
import { PG_POOL_OPTIONS } from '../prisma/helpers';

/** A gRPC call slower than this logs where its time went. */
export const SLOW_CALL_MS = 1_000;

/**
 * One gRPC call's database time, summed as it runs (parallel queries each count in full), with the
 * waits and queries still running: a call the gateway cancelled at its deadline is reported then.
 */
interface CallTimes {
  waitMs: number;
  queryMs: number;
  queries: number;
  readonly waiting: Set<number>;
  readonly querying: Set<number>;
}

const newTimes = (): CallTimes => ({
  waitMs: 0,
  queryMs: 0,
  queries: 0,
  waiting: new Set(),
  querying: new Set(),
});

/** The time spent so far by what started at `starts`. */
const sinceEach = (starts: ReadonlySet<number>, now: number): number =>
  [...starts].reduce((sum, start) => sum + now - start, 0);

const calls = new AsyncLocalStorage<CallTimes>();
const pools = new Set<TimedPool>();

/**
 * A `pg` pool that charges the gRPC call it serves with the time spent waiting for a connection
 * and the time its queries took. Prisma's adapter runs plain queries through `pool.query` and
 * transactions on `pool.connect()`'s client, so waits are counted for both and query time for
 * the plain ones.
 */
export class TimedPool extends pg.Pool {
  constructor(config: pg.PoolConfig) {
    super(config);
    pools.add(this);
    // `pool.query`, wrapped rather than overridden (its overloads): only the promise form — the
    // adapter's — is timed; waiting inside it is the connection's, already charged.
    const query = this.query.bind(this) as (...args: unknown[]) => unknown;
    this.query = ((...args: unknown[]) => {
      const times = calls.getStore();
      const result = query(...args);
      if (times === undefined || !(result instanceof Promise)) return result;
      const started = performance.now();
      const waitedBefore = times.waitMs;
      times.querying.add(started);
      return result.finally(() => {
        times.querying.delete(started);
        times.queries += 1;
        times.queryMs += performance.now() - started - (times.waitMs - waitedBefore);
      });
    }) as pg.Pool['query'];
  }

  override connect(): Promise<pg.PoolClient>;
  override connect(
    callback: (
      error: Error | undefined,
      client: pg.PoolClient | undefined,
      done: () => void,
    ) => void,
  ): void;
  override connect(
    callback?: (
      error: Error | undefined,
      client: pg.PoolClient | undefined,
      done: () => void,
    ) => void,
  ): Promise<pg.PoolClient> | void {
    const times = calls.getStore();
    const started = performance.now();
    times?.waiting.add(started);
    const charge = () => {
      if (times === undefined) return;
      times.waiting.delete(started);
      times.waitMs += performance.now() - started;
    };
    if (callback !== undefined) {
      super.connect((error, client, done) => {
        charge();
        callback(error, client, done);
      });
      return;
    }
    return super.connect().finally(charge);
  }

  /**
   * Opens every connection the pool may hold (`max`), then hands them back idle. Opening one costs
   * a name lookup and the password's hash on libuv's thread pool, which an image job can hold for
   * seconds: a call that had to open one waited past the gateway's 2 s deadline. Idle connections
   * are never closed (`PG_POOL_OPTIONS`), so after this a call only takes one.
   */
  async fill(): Promise<void> {
    const max = this.options.max ?? 10;
    const opened = await Promise.all(Array.from({ length: max }, () => super.connect()));
    for (const client of opened) client.release();
  }
}

/** Fills every timed pool in the process (`TimedPool.fill`). */
export async function fillPools(): Promise<void> {
  await Promise.all([...pools].map((pool) => pool.fill()));
}

/** A service's Prisma pool, timed: `new PrismaPg(timedPool(url), { disposeExternalPool: true })`. */
export function timedPool(connectionString: string): TimedPool {
  return new TimedPool({ connectionString, ...PG_POOL_OPTIONS });
}

type Outcome = 'answered' | 'failed' | 'cancelled';

/**
 * Every gRPC call slower than `SLOW_CALL_MS` logs one warning: its method, its trace, how it ended
 * (answered, failed, or cancelled by the caller — the gateway at its deadline), and where the time
 * went — waiting for a database connection, in queries, the rest — with what was still in flight
 * and each pool's waiting, total and idle counts at that moment. For a stall to name its cause.
 * Set on the app before the gRPC microservice connects, with `inheritAppConfig`: a microservice
 * registers its handlers as it connects, and ignores a global interceptor set on it later.
 */
@Injectable()
export class SlowCallInterceptor implements NestInterceptor {
  private readonly logger = new Logger('SlowCall');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'rpc') return next.handle();
    const method = `${context.getClass().name}.${context.getHandler().name}`;
    const traceId = trace.getActiveSpan()?.spanContext().traceId ?? null;
    const times = newTimes();
    const started = performance.now();
    let reported = false;
    const report = (outcome: Outcome) => {
      if (reported) return;
      reported = true;
      const now = performance.now();
      const totalMs = now - started;
      if (totalMs < SLOW_CALL_MS) return;
      const waitMs = times.waitMs + sinceEach(times.waiting, now);
      const queryMs = times.queryMs + sinceEach(times.querying, now);
      this.logger.warn(
        {
          method,
          traceId,
          outcome,
          totalMs: Math.round(totalMs),
          poolWaitMs: Math.round(waitMs),
          queryMs: Math.round(queryMs),
          queries: times.queries,
          inFlight: { waiting: times.waiting.size, querying: times.querying.size },
          otherMs: Math.round(Math.max(0, totalMs - waitMs - queryMs)),
          pools: [...pools].map((pool) => ({
            waiting: pool.waitingCount,
            total: pool.totalCount,
            idle: pool.idleCount,
          })),
        },
        `slow call: ${method} ${outcome} after ${Math.round(totalMs)} ms`,
      );
    };
    return new Observable((subscriber) => {
      const inner = calls.run(times, () =>
        next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (error: unknown) => {
            report('failed');
            subscriber.error(error);
          },
          complete: () => {
            report('answered');
            subscriber.complete();
          },
        }),
      );
      // Unsubscribed before an answer: the caller gave up, at its deadline or by cancelling.
      return () => {
        report('cancelled');
        inner.unsubscribe();
      };
    });
  }
}
