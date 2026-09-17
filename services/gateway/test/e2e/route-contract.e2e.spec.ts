import { Controller, Get, Module } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { effectiveAuth, RouteContractCheck, RouteContractError } from '@wayfare/nest-common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { IdentityServiceGrpcClient } from '../../src/modules/identity/identity-service-grpc.client';
import { REDIS } from '../../src/modules/ops/redis.module';
import { snapshotProcessEnv } from '@wayfare/nest-common/testing';
import { bootGateway, e2eEnv, E2eRedis, IdentityStub } from '../support/app';
import type { E2eApp } from '../support/app';

let gateway: E2eApp;

beforeAll(async () => {
  gateway = await bootGateway();
});

afterAll(() => gateway.app.close());

/** Every HTTP handler of the booted gateway with its rule. */
function routes() {
  const discovery = gateway.app.get(DiscoveryService);
  const scanner = gateway.app.get(MetadataScanner);
  const reflector = gateway.app.get(Reflector);
  return discovery.getControllers().flatMap(({ instance, metatype }) => {
    if (!instance || !metatype) return [];
    const prototype = Object.getPrototypeOf(instance) as Record<
      string,
      (...args: never[]) => unknown
    >;
    return scanner
      .getAllMethodNames(prototype)
      .filter(
        (name) =>
          Reflect.getMetadata(PATH_METADATA, prototype[name]!) !== undefined &&
          Reflect.getMetadata(METHOD_METADATA, prototype[name]!) !== undefined,
      )
      .map((name) => ({
        name: `${metatype.name}.${name}`,
        handler: prototype[name]!,
        auth: effectiveAuth(reflector, prototype[name]!, metatype as never),
      }));
  });
}

/** Headers a handler sets through `@Header`. */
function headersOf(handler: object): Record<string, string> {
  const entries = (Reflect.getMetadata('__headers__', handler) ?? []) as {
    name: string;
    value: string;
  }[];
  return Object.fromEntries(entries.map((entry) => [entry.name.toLowerCase(), entry.value]));
}

describe('route contract', () => {
  it('holds for every gateway route', () => {
    const check = gateway.app.get(RouteContractCheck);
    expect(check.problems()).toEqual([]);
    expect(routes().length).toBeGreaterThanOrEqual(18);
  });

  it('marks every account route and every session or secret response private, no-store', () => {
    const mustNotCache = new Set([
      'DevicesController.register',
      'DevicesController.exchange',
      'AuthController.register',
      'AuthController.login',
      'AuthController.refresh',
    ]);
    for (const route of routes()) {
      const isUserRoute =
        route.auth.kind === 'marker' &&
        route.auth.rule.marker === 'USER' &&
        route.name.startsWith('UsersController');
      if (isUserRoute || mustNotCache.has(route.name)) {
        expect(headersOf(route.handler)['cache-control'], route.name).toBe('private, no-store');
      }
    }
  });

  it('refuses to boot with a planted route that has no @Auth', async () => {
    @Controller('planted')
    class PlantedController {
      @Get()
      forgotten() {
        return 'open';
      }
    }
    @Module({ controllers: [PlantedController] })
    class PlantedModule {}

    const restoreEnv = snapshotProcessEnv();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot({ env: e2eEnv() }), PlantedModule],
    })
      .overrideProvider(IdentityServiceGrpcClient)
      .useValue(new IdentityStub())
      .overrideProvider(REDIS)
      .useValue(new E2eRedis())
      .compile();
    const app = moduleRef.createNestApplication({ logger: false });
    const error = await app.init().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RouteContractError);
    expect((error as Error).message).toContain('PlantedController.forgotten has no @Auth');
    await app.close().catch(() => undefined);
    restoreEnv();
  });
});
