import { Global, Inject, Injectable, Module } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import type { ReadinessCheck } from '@wayfare/nest-common';
import { Redis } from 'ioredis';
import { ConfigService } from '@nestjs/config';
import type { IdentityConfig } from '../../config/env.schema';

/** Injection token for identity's Redis client. */
export const REDIS = Symbol('REDIS');

/**
 * identity's Redis client — the revocation state the gateway reads (api-endpoints-plan §0.1).
 * Offline commands fail fast; the revocation consumer then naks and the message is redelivered.
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
      useFactory: (config: IdentityConfig) =>
        new Redis(config.get('REDIS_URL', { infer: true }), {
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectionName: 'identity',
        }),
    },
    RedisLifecycle,
  ],
  exports: [REDIS, RedisLifecycle],
})
export class RedisModule {}
