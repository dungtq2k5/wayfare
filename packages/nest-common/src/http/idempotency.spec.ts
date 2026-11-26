import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '../context/request-context';
import {
  buildAccountContext,
  buildAnonymousContext,
  buildDeviceContext,
} from '../testing/contexts';
import { FakeRedis } from '../testing/fake-redis';
import { AppHttpException, ReplayedHttpError } from './app-http.exception';
import { IdempotencyInterceptor } from './idempotency';
import { setAuthState } from './request-context';

const KEY = '01990000-0000-7000-8000-000000000001';

/** The fake as the interceptor's store: the commands it calls, typed loosely. */
const store = (redis: FakeRedis) =>
  redis as unknown as ConstructorParameters<typeof IdempotencyInterceptor>[0];

function execution(
  options: { key?: string; body?: unknown; caller?: RequestContext; route?: string } = {},
): { context: ExecutionContext; request: Request } {
  const request = {
    method: 'POST',
    path: '/owner/billing/checkout',
    route: options.route === undefined ? undefined : { path: options.route },
    ip: '203.0.113.9',
    body: options.body ?? { planPriceId: 'p' },
    header: (name: string) => (name === 'Idempotency-Key' ? options.key : undefined),
  } as unknown as Request;
  setAuthState(request, { context: options.caller ?? buildAccountContext(), authError: null });
  const context = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

const handler = (run: () => ReturnType<CallHandler['handle']>) => {
  const handle = vi.fn(run);
  return { handle };
};

const call = (interceptor: IdempotencyInterceptor, context: ExecutionContext, next: CallHandler) =>
  firstValueFrom(interceptor.intercept(context, next));

const codeOf = async (run: () => Promise<unknown>) => {
  try {
    await run();
    return 'ok';
  } catch (error) {
    if (error instanceof AppHttpException || error instanceof ReplayedHttpError) return error.code;
    throw error;
  }
};

describe('an idempotent route (api-endpoints-plan §0.8)', () => {
  it('requires a key, as a UUIDv7', async () => {
    const interceptor = new IdempotencyInterceptor(store(new FakeRedis()));
    const next = handler(() => of('done'));
    expect(await codeOf(() => call(interceptor, execution().context, next))).toBe(
      'IDEMPOTENCY_KEY_REQUIRED',
    );
    expect(await codeOf(() => call(interceptor, execution({ key: '' }).context, next))).toBe(
      'IDEMPOTENCY_KEY_REQUIRED',
    );
    expect(await codeOf(() => call(interceptor, execution({ key: 'abc' }).context, next))).toBe(
      'VALIDATION_FAILED',
    );
    expect(next.handle).not.toHaveBeenCalled();
  });

  it('runs once and replays the answer to a repeat with the same body, in any key order', async () => {
    const redis = new FakeRedis();
    const interceptor = new IdempotencyInterceptor(store(redis));
    const next = handler(() => of({ url: 'https://checkout' }));
    const caller = buildAccountContext();
    const first = execution({ key: KEY, caller, body: { a: 1, b: 2 }, route: '/checkout' });
    expect(await call(interceptor, first.context, next)).toEqual({ url: 'https://checkout' });
    const again = execution({ key: KEY, caller, body: { b: 2, a: 1 }, route: '/checkout' });
    expect(await call(interceptor, again.context, next)).toEqual({ url: 'https://checkout' });
    expect(next.handle).toHaveBeenCalledTimes(1);
    // The lock is released once the answer is stored.
    expect([...redis.values.keys()].some((key) => key.endsWith(':lock'))).toBe(false);
  });

  it('refuses the key with another body, and while the first request still runs', async () => {
    const redis = new FakeRedis();
    const interceptor = new IdempotencyInterceptor(store(redis));
    const caller = buildAccountContext();
    await call(
      interceptor,
      execution({ key: KEY, caller }).context,
      handler(() => of(1)),
    );
    expect(
      await codeOf(() =>
        call(
          interceptor,
          execution({ key: KEY, caller, body: { other: true } }).context,
          handler(() => of(1)),
        ),
      ),
    ).toBe('IDEMPOTENCY_KEY_REUSED');
    const other = '01990000-0000-7000-8000-000000000002';
    const storeKeys = () => [...redis.values.keys()];
    const [stored] = storeKeys();
    redis.values.set(stored!.replace(KEY, other) + ':lock', '1');
    expect(
      await codeOf(() =>
        call(
          interceptor,
          execution({ key: other, caller }).context,
          handler(() => of(1)),
        ),
      ),
    ).toBe('IDEMPOTENCY_KEY_IN_FLIGHT');
  });

  it('replays a 4xx refusal as it was, and stores no 5xx so a retry runs again', async () => {
    const interceptor = new IdempotencyInterceptor(store(new FakeRedis()));
    const device = buildDeviceContext();
    const refusal = handler(() =>
      throwError(() => new AppHttpException('VALIDATION_FAILED', { issues: [] })),
    );
    const first = execution({ key: KEY, caller: device });
    expect(await codeOf(() => call(interceptor, first.context, refusal))).toBe('VALIDATION_FAILED');
    expect(
      await codeOf(() =>
        call(interceptor, execution({ key: KEY, caller: device }).context, refusal),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(refusal.handle).toHaveBeenCalledTimes(1);

    const outage = handler(() => throwError(() => new Error('boom')));
    const anonymous = buildAnonymousContext();
    const key = '01990000-0000-7000-8000-000000000003';
    await expect(
      call(interceptor, execution({ key, caller: anonymous }).context, outage),
    ).rejects.toThrow('boom');
    await expect(
      call(interceptor, execution({ key, caller: anonymous }).context, outage),
    ).rejects.toThrow('boom');
    expect(outage.handle).toHaveBeenCalledTimes(2);
  });

  it('fails open when the store can’t be read, taken or written', async () => {
    const redis = new FakeRedis();
    redis.failure = new Error('redis down');
    const interceptor = new IdempotencyInterceptor(store(redis));
    const next = handler(() => of('ran'));
    expect(await call(interceptor, execution({ key: KEY }).context, next)).toBe('ran');

    const lockFails = new FakeRedis();
    vi.spyOn(lockFails, 'set').mockRejectedValue('down');
    expect(
      await call(
        new IdempotencyInterceptor(store(lockFails)),
        execution({ key: KEY }).context,
        next,
      ),
    ).toBe('ran');

    const writeFails = new FakeRedis();
    vi.spyOn(writeFails, 'set')
      .mockResolvedValueOnce('OK')
      .mockRejectedValueOnce(new Error('down'));
    expect(
      await call(
        new IdempotencyInterceptor(store(writeFails)),
        execution({ key: KEY }).context,
        next,
      ),
    ).toBe('ran');
  });

  it('hashes a body canonical JSON can’t read by its plain JSON, so it still runs once', async () => {
    const interceptor = new IdempotencyInterceptor(store(new FakeRedis()));
    const next = handler(() => of('ran'));
    const body = { at: new Date(0), n: 1.5 };
    const caller = buildAccountContext();
    await call(interceptor, execution({ key: KEY, body, caller }).context, next);
    await call(interceptor, execution({ key: KEY, body, caller }).context, next);
    expect(next.handle).toHaveBeenCalledTimes(1);
  });
});
