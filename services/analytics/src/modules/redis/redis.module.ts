import { Global, Inject, Injectable, Module } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ReadinessCheck } from '@wayfare/nest-common';
import { Redis } from 'ioredis';
import type { AnalyticsConfig } from '../../config/env.schema';

/** Injection token for analytics' Redis client. */
export const REDIS = Symbol('REDIS');

/**
 * analytics' Redis client: the heatmap's cell-hour counters it adds to and counts, and the runtime
 * lane's Area-hour counters the gateway adds to (rdm-spec A-3, A-5).
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
      useFactory: (config: AnalyticsConfig) =>
        new Redis(config.get('REDIS_URL', { infer: true }), {
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectionName: 'analytics',
        }),
    },
    RedisLifecycle,
  ],
  exports: [REDIS, RedisLifecycle],
})
export class RedisModule {}
