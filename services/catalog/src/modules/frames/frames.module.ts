import { Global, Inject, Injectable, Module } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SocketEmitter } from '@wayfare/nest-common';
import { Redis } from 'ioredis';
import type { CatalogConfig } from '../../config/env.schema';

/** Injection token for catalog's socket frames (conventions §7.4). */
export const SOCKET_EMITTER = Symbol('SOCKET_EMITTER');

/** Injection token for the Redis client the frames go through. */
const FRAMES_REDIS = Symbol('FRAMES_REDIS');

/** Closes the frames' Redis client at shutdown. */
@Injectable()
export class FramesRedisLifecycle implements OnApplicationShutdown {
  constructor(@Inject(FRAMES_REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}

/**
 * Socket frames from catalog, over the Redis the gateway's adapter reads — catalog has no socket
 * server of its own. A frame is only the fast path: an offline Redis loses it, never a write.
 */
@Global()
@Module({
  providers: [
    {
      provide: FRAMES_REDIS,
      inject: [ConfigService],
      useFactory: (config: CatalogConfig) =>
        new Redis(config.get('REDIS_URL', { infer: true }), {
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectionName: 'catalog-frames',
        }),
    },
    {
      provide: SOCKET_EMITTER,
      inject: [FRAMES_REDIS],
      useFactory: (redis: Redis) => new SocketEmitter(redis),
    },
    FramesRedisLifecycle,
  ],
  exports: [SOCKET_EMITTER],
})
export class FramesModule {}
