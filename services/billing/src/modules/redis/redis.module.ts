import { Global, Inject, Injectable, Module } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import type { ReadinessCheck } from '@wayfare/nest-common';
import { Redis } from 'ioredis';
import { ConfigService } from '@nestjs/config';
import type { BillingConfig } from '../../config/env.schema';

/** Injection token for billing's Redis client. */
export const REDIS = Symbol('REDIS');

/**
 * billing's Redis client: the invoice cache (api-endpoints-plan §5.1).
 * Offline commands fail fast: an invoice read that cannot use the cache asks Stripe.
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
      useFactory: (config: BillingConfig) =>
        new Redis(config.get('REDIS_URL', { infer: true }), {
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectionName: 'billing',
        }),
    },
    RedisLifecycle,
  ],
  exports: [REDIS, RedisLifecycle],
})
export class RedisModule {}
