import { Controller, Get, Post } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import type { RequestContext } from '../context/request-context';
import {
  buildAccountContext,
  buildAnonymousContext,
  buildDeviceContext,
} from '../testing/contexts';
import { FakeRedis } from '../testing/fake-redis';
import { AppHttpException } from './app-http.exception';
import { AppVersionGuard, compareSemver } from './app-version.guard';
import { AppVersionFromBody, Auth, RateLimit, RequirePermission } from './auth.decorators';
import { AuthGuard } from './auth.guard';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimiter } from './rate-limiter';
import { setAuthState } from './request-context';
import type { AuthError } from './request-context';

@Controller()
class Routes {
  @Get() @Auth('PUBLIC') publicRoute() {}
  @Get() @Auth('DEVICE') deviceRoute() {}
  @Get() @Auth('USER') userRoute() {}
  @Post() @Auth('USER', { alsoDevice: true }) userAndDevice() {}
  @Get() @Auth('USER_EMAIL') emailRoute() {}
  @Get() @Auth('OWNER') ownerRoute() {}
  @Get() @Auth('STAFF') staffRoute() {}
  @Post() @Auth('SIGNATURE') signatureRoute() {}
  @Get() @RequirePermission('place.read', 'place.update') permissionRoute() {}
  @Get() unmarked() {}
  @Post() @Auth('PUBLIC') @RateLimit('AUTH') login() {}
  @Post() @Auth('PUBLIC') @RateLimit(null) probe() {}
  @Post() @Auth('PUBLIC') @AppVersionFromBody('appVersion') registerDevice() {}
}

type RouteName = Exclude<keyof Routes, 'constructor'>;

function execution(
  route: RouteName,
  context: RequestContext,
  authError: AuthError | null = null,
  request: Partial<{ headers: Record<string, string>; body: unknown; ip: string }> = {},
): ExecutionContext {
  const headers = request.headers ?? {};
  const req = {
    ip: request.ip ?? '203.0.113.9',
    body: request.body,
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
  setAuthState(req, { context, authError });
  return {
    getType: () => 'http',
    getHandler: () => Routes.prototype[route],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

async function outcome(
  run: Promise<boolean> | boolean | (() => Promise<boolean> | boolean),
): Promise<string> {
  try {
    return (await (typeof run === 'function' ? run() : run)) ? 'allow' : 'deny';
  } catch (error) {
    if (error instanceof AppHttpException) return error.code;
    throw error;
  }
}

const reflector = new Reflector();
const anonymous = buildAnonymousContext();
const device = buildDeviceContext();
const account = buildAccountContext();
const phone = buildAccountContext({ deviceId: device.deviceId });
const unverified = buildAccountContext({ emailVerified: false });
const owner = buildAccountContext({ ownerVerified: true, permissions: ['owner.access'] });
const moderator = buildAccountContext({ permissions: ['place.update'] });

function authGuard(redis = new FakeRedis()) {
  return new AuthGuard(reflector, new RateLimiter(redis));
}

describe('AuthGuard', () => {
  it.each<[RouteName, RequestContext, AuthError | null, string]>([
    ['publicRoute', anonymous, null, 'allow'],
    ['publicRoute', anonymous, 'invalid', 'allow'],
    ['publicRoute', anonymous, 'unverifiable', 'allow'],
    ['signatureRoute', anonymous, null, 'allow'],
    ['deviceRoute', device, null, 'allow'],
    ['deviceRoute', device, 'revoked', 'allow'],
    ['deviceRoute', phone, null, 'allow'],
    ['deviceRoute', account, null, 'UNAUTHENTICATED'],
    ['deviceRoute', anonymous, 'invalid', 'UNAUTHENTICATED'],
    ['userRoute', account, null, 'allow'],
    ['userRoute', device, 'revoked', 'UNAUTHENTICATED'],
    ['userRoute', anonymous, 'invalid', 'UNAUTHENTICATED'],
    ['userRoute', anonymous, 'unverifiable', 'UPSTREAM_UNAVAILABLE'],
    ['userRoute', device, 'unverifiable', 'UPSTREAM_UNAVAILABLE'],
    ['userAndDevice', phone, null, 'allow'],
    ['userAndDevice', account, null, 'UNAUTHENTICATED'],
    ['emailRoute', account, null, 'allow'],
    ['emailRoute', unverified, null, 'EMAIL_NOT_VERIFIED'],
    ['emailRoute', anonymous, null, 'UNAUTHENTICATED'],
    ['ownerRoute', owner, null, 'allow'],
    ['ownerRoute', account, null, 'PERMISSION_DENIED'],
    ['ownerRoute', buildAccountContext({ ownerVerified: true }), null, 'PERMISSION_DENIED'],
    ['ownerRoute', anonymous, null, 'UNAUTHENTICATED'],
    ['staffRoute', account, null, 'RESOURCE_NOT_FOUND'],
    ['permissionRoute', moderator, null, 'allow'],
    ['permissionRoute', account, null, 'PERMISSION_DENIED'],
    ['permissionRoute', device, null, 'UNAUTHENTICATED'],
    ['unmarked', account, null, 'UNAUTHENTICATED'],
  ])('%s with a %s caller (authError %s) → %s', async (route, context, authError, expected) => {
    expect(await outcome(authGuard().canActivate(execution(route, context, authError)))).toBe(
      expected,
    );
  });

  it('names the codes a permission route requires, and owner.access for an owner route', async () => {
    const denied = await authGuard()
      .canActivate(execution('permissionRoute', account))
      .catch((e: unknown) => e);
    expect((denied as AppHttpException).details).toEqual({
      required: ['place.read', 'place.update'],
    });
    const notOwner = await authGuard()
      .canActivate(execution('ownerRoute', account))
      .catch((e: unknown) => e);
    expect((notOwner as AppHttpException).details).toEqual({ required: ['owner.access'] });
  });

  it('counts rejected requests against the IP, turning a flood into 429', async () => {
    const guard = authGuard();
    for (let attempt = 0; attempt < 120; attempt++) {
      expect(await outcome(guard.canActivate(execution('userRoute', anonymous, 'invalid')))).toBe(
        'UNAUTHENTICATED',
      );
    }
    expect(await outcome(guard.canActivate(execution('userRoute', anonymous, 'invalid')))).toBe(
      'RATE_LIMITED',
    );
  });
});

describe('RateLimitGuard', () => {
  it('trips the email bucket while the IP rotates, with a retry time', async () => {
    const redis = new FakeRedis();
    const guard = new RateLimitGuard(reflector, new RateLimiter(redis));
    const attempt = (ip: string) =>
      guard.canActivate(
        execution('login', anonymous, null, { ip, body: { email: ' Ann@Example.com ' } }),
      );
    for (let n = 0; n < 10; n++) expect(await outcome(attempt(`198.51.100.${n}`))).toBe('allow');
    const error = await attempt('198.51.100.99').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppHttpException);
    expect((error as AppHttpException).code).toBe('RATE_LIMITED');
    expect((error as AppHttpException).details).toEqual({ retryAfterSeconds: 900 });
    expect([...redis.values.keys()].some((key) => key.includes('ann@example.com'))).toBe(false);
  });

  it('uses the marker default, and never counts a null class', async () => {
    const redis = new FakeRedis();
    const guard = new RateLimitGuard(reflector, new RateLimiter(redis));
    await guard.canActivate(execution('userRoute', account));
    await guard.canActivate(execution('probe', anonymous));
    expect([...redis.values.keys()]).toEqual([`rl:AUTHENTICATED:userId:${account.userId}`]);
  });

  it('fails open when the store is down', async () => {
    const redis = new FakeRedis();
    redis.failure = new Error('down');
    const guard = new RateLimitGuard(reflector, new RateLimiter(redis));
    expect(
      await outcome(
        guard.canActivate(execution('login', anonymous, null, { body: { email: 'a@b.co' } })),
      ),
    ).toBe('allow');
  });
});

describe('AppVersionGuard', () => {
  const mobile = (headers: Record<string, string> = {}, body?: unknown) => ({
    headers: { 'x-wayfare-client': 'mobile', ...headers },
    body,
  });

  it('checks nothing while the floor is 0.0.0', async () => {
    const guard = new AppVersionGuard(reflector, '0.0.0');
    expect(await outcome(guard.canActivate(execution('userRoute', account, null, mobile())))).toBe(
      'allow',
    );
  });

  it('refuses a mobile build below the floor, or one without a version', async () => {
    const guard = new AppVersionGuard(reflector, '1.2.0');
    const check = (request: ReturnType<typeof mobile>, route: RouteName = 'userRoute') =>
      outcome(() => guard.canActivate(execution(route, account, null, request)));
    expect(await check(mobile({ 'x-wayfare-app-version': '1.2.0' }))).toBe('allow');
    expect(await check(mobile({ 'x-wayfare-app-version': '1.10.0-beta.1' }))).toBe('allow');
    expect(await check(mobile({ 'x-wayfare-app-version': '1.1.9' }))).toBe(
      'APP_VERSION_UNSUPPORTED',
    );
    expect(await check(mobile())).toBe('APP_VERSION_UNSUPPORTED');
    expect(await check(mobile({ 'x-wayfare-app-version': 'latest' }))).toBe(
      'APP_VERSION_UNSUPPORTED',
    );
    expect(await check({ headers: { 'x-wayfare-client': 'console' }, body: undefined })).toBe(
      'allow',
    );
  });

  it('judges POST /devices by its body', async () => {
    const guard = new AppVersionGuard(reflector, '1.0.0');
    const error = await Promise.resolve()
      .then(() =>
        guard.canActivate(
          execution('registerDevice', anonymous, null, mobile({}, { appVersion: '0.0.1' })),
        ),
      )
      .catch((e: unknown) => e);
    expect((error as AppHttpException).details).toEqual({ minimumVersion: '1.0.0' });
    expect(
      await outcome(() =>
        guard.canActivate(
          execution('registerDevice', anonymous, null, mobile({}, { appVersion: '1.0.0' })),
        ),
      ),
    ).toBe('allow');
  });

  it('compares versions numerically', () => {
    expect(compareSemver('1.10.0', '1.9.9')).toBe(1);
    expect(compareSemver('2.0.0', '2.0.0+45')).toBe(0);
    expect(compareSemver('1.0', '1.0.0')).toBeNull();
  });
});
