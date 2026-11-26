import type { ExecutionContext } from '@nestjs/common';
import { Controller, Get } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { CLIENT_HEADER } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { AppHttpException } from './app-http.exception';
import { ClientHeaderGuard, ClientKind } from './client-header.guard';
import { SkipClientHeader } from './skip-client-header.decorator';

@Controller()
class Routes {
  @Get() checked() {}
  @Get() @SkipClientHeader() webhook() {}
  @Get() handle(@ClientKind() _client: unknown) {}
}

function http(route: keyof Routes, client?: string, type = 'http'): ExecutionContext {
  const request = { header: (name: string) => (name === CLIENT_HEADER ? client : undefined) };
  return {
    getType: () => type,
    getHandler: () => Routes.prototype[route],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const codeOf = (run: () => unknown) => {
  try {
    run();
    return 'allow';
  } catch (error) {
    return (error as AppHttpException).code;
  }
};

describe('the client header (api-endpoints-plan §0.3)', () => {
  const guard = new ClientHeaderGuard(new Reflector());

  it('requires a known client on every HTTP request', () => {
    expect(codeOf(() => guard.canActivate(http('checked', 'console')))).toBe('allow');
    expect(codeOf(() => guard.canActivate(http('checked', 'curl')))).toBe('CLIENT_HEADER_REQUIRED');
    expect(codeOf(() => guard.canActivate(http('checked')))).toBe('CLIENT_HEADER_REQUIRED');
  });

  it('lets a route that skips it, and anything but HTTP, through', () => {
    expect(guard.canActivate(http('webhook'))).toBe(true);
    expect(guard.canActivate(http('checked', undefined, 'rpc'))).toBe(true);
  });

  it('injects the checked client, and refuses a request the guard never saw', () => {
    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, Routes, 'handle') as Record<
      string,
      { factory: (data: unknown, host: ExecutionContext) => unknown }
    >;
    const [definition] = Object.values(args);
    expect(definition!.factory(undefined, http('handle', 'mobile'))).toBe('mobile');
    expect(codeOf(() => definition!.factory(undefined, http('handle')))).toBe(
      'CLIENT_HEADER_REQUIRED',
    );
  });
});
