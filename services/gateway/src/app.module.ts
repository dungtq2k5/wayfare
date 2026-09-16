import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ClientHeaderGuard, createLoggerModule, OpsModule } from '@wayfare/nest-common';
import { AppConfig } from './config/env.schema';
import { DevicesModule } from './modules/devices/devices.module';
import { RedisLifecycle, RedisModule } from './modules/ops/redis.module';

/** Makes the parsed configuration injectable everywhere. */
@Module({})
class ConfigModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      global: true,
      providers: [{ provide: AppConfig, useValue: config }],
      exports: [AppConfig],
    };
  }
}

/** The gateway — the only public HTTP surface. No database, no business logic (conventions §2.2). */
@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        createLoggerModule({ level: config.LOG_LEVEL }),
        RedisModule,
        // Ops routes ride the public port here; readiness checks Redis only (api-endpoints-plan §13).
        OpsModule.forRoot({
          version: {
            service: 'gateway',
            version: config.APP_VERSION,
            gitSha: config.GIT_SHA,
            builtAt: config.BUILT_AT,
          },
          checks: {
            inject: [RedisLifecycle],
            useFactory: (redis: RedisLifecycle) => [redis.readinessCheck()],
          },
        }),
        DevicesModule,
      ],
      // First in the guard chain for every route (conventions §5.3).
      providers: [{ provide: APP_GUARD, useClass: ClientHeaderGuard }],
    };
  }
}
