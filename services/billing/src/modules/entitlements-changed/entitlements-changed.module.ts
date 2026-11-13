import { Module } from '@nestjs/common';
import { SocketEmitter } from '@wayfare/nest-common';
import type { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.module';
import { EntitlementsChangedConsumer, SOCKET_EMITTER } from './entitlements-changed.consumer';

/**
 * The owner's live limits frame, over the Redis the gateway's adapter reads — billing has no
 * socket server of its own.
 */
@Module({
  providers: [
    {
      provide: SOCKET_EMITTER,
      inject: [REDIS],
      useFactory: (redis: Redis) => new SocketEmitter(redis),
    },
    EntitlementsChangedConsumer,
  ],
  exports: [EntitlementsChangedConsumer],
})
export class EntitlementsChangedModule {}
