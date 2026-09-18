import { Global, Inject, Injectable, Module } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import type { ReadinessCheck } from '@wayfare/nest-common';
import { Redis } from 'ioredis';
import { ConfigService } from '@nestjs/config';
import type { NarrationConfig } from '../../config/env.schema';

/** Injection token for narration's Redis client. */
export const REDIS = Symbol('REDIS');

/**
 * narration's Redis client: the cached voice catalogues (api-endpoints-plan §4.3).
 * Offline commands fail fast: a cache read that cannot answer falls back to the provider.
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
      useFactory: (config: NarrationConfig) =>
        new Redis(config.get('REDIS_URL', { infer: true }), {
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectionName: 'narration',
        }),
    },
    RedisLifecycle,
  ],
  exports: [REDIS, RedisLifecycle],
})
export class RedisModule {}
