import { Global, Inject, Injectable, Module } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import type { ReadinessCheck } from '@wayfare/nest-common';
import { Redis } from 'ioredis';
import { ConfigService } from '@nestjs/config';
import type { GatewayConfig } from '../../config/env.schema';

/** Injection token for the gateway's Redis client. */
export const REDIS = Symbol('REDIS');

/**
 * The gateway's Redis client — edge state only (conventions §2.2). In this skeleton only
 * readiness uses it. Offline commands fail fast so a probe never hangs on a dead Redis.
 */
@Injectable()
export class RedisLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Readiness: Redis answers PING. */
  readinessCheck(): ReadinessCheck {
    return {
      name: 'redis',
      check: async () => {
        await this.redis.ping();
      },
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}

/** Provides the Redis client and its readiness check. */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: GatewayConfig) =>
        new Redis(config.get('REDIS_URL', { infer: true }), {
          lazyConnect: false,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectionName: 'gateway',
        }),
    },
    RedisLifecycle,
  ],
  exports: [REDIS, RedisLifecycle],
})
export class RedisModule {}
