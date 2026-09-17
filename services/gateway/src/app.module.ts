import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, DiscoveryModule, Reflector } from '@nestjs/core';
import {
  AppVersionGuard,
  AuthGuard,
  ClientHeaderGuard,
  createConfigModule,
  createLoggerModuleAsync,
  OpsModule,
  RateLimiter,
  RateLimitGuard,
  RouteContractCheck,
} from '@wayfare/nest-common';
import type { Redis } from 'ioredis';
import { envSchema } from './config/env.schema';
import type { GatewayConfig } from './config/env.schema';
import { AuthModule } from './modules/auth/auth.module';
import { DevicesModule } from './modules/devices/devices.module';
import { IdentityModule } from './modules/identity/identity.module';
import { REDIS, RedisLifecycle, RedisModule } from './modules/ops/redis.module';
import { UsersModule } from './modules/users/users.module';

/** The gateway — the only public HTTP surface. No database, no business logic (conventions §2.2). */
@Module({})
export class AppModule {
  /** `env` is for tests only: validate exactly that object, ignoring `.env` and `process.env`. */
  static forRoot(
    options: { env?: Readonly<Record<string, string | undefined>> } = {},
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [
        createConfigModule('gateway', envSchema, { source: options.env }),
        createLoggerModuleAsync(),
        DiscoveryModule,
        RedisModule,
        // Ops routes ride the public port here; readiness checks Redis only (api-endpoints-plan §13).
        OpsModule.forRootAsync({
          inject: [ConfigService, RedisLifecycle],
          useFactory: (config: GatewayConfig, redis: RedisLifecycle) => ({
            version: {
              service: 'gateway',
              version: config.get('APP_VERSION', { infer: true }),
              gitSha: config.get('GIT_SHA', { infer: true }),
              builtAt: config.get('BUILT_AT', { infer: true }),
            },
            checks: [redis.readinessCheck()],
          }),
        }),
        IdentityModule,
        DevicesModule,
        AuthModule,
        UsersModule,
      ],
      providers: [
        {
          provide: RateLimiter,
          inject: [REDIS],
          useFactory: (redis: Redis) => new RateLimiter(redis),
        },
        // Deny-by-default: an HTTP route without an auth rule stops the boot (conventions §5.3).
        RouteContractCheck,
        // The guard chain, in order (conventions §5.3). The caller was resolved by the middleware.
        { provide: APP_GUARD, useClass: ClientHeaderGuard },
        {
          provide: APP_GUARD,
          inject: [Reflector, ConfigService],
          useFactory: (reflector: Reflector, config: GatewayConfig) =>
            new AppVersionGuard(
              reflector,
              config.get('MIN_SUPPORTED_APP_VERSION', { infer: true }),
            ),
        },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: RateLimitGuard },
      ],
    };
  }
}
