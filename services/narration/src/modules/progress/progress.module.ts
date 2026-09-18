import { Global, Module } from '@nestjs/common';
import { SocketEmitter } from '@wayfare/nest-common';
import type { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.module';
import { ProgressService, SOCKET_EMITTER } from './progress.service';

/**
 * Socket frames from narration, over the Redis the gateway's adapter reads (conventions §7.4) —
 * narration has no socket server of its own.
 */
@Global()
@Module({
  providers: [
    {
      provide: SOCKET_EMITTER,
      inject: [REDIS],
      useFactory: (redis: Redis) => new SocketEmitter(redis),
    },
    ProgressService,
  ],
  exports: [ProgressService],
})
export class ProgressModule {}
