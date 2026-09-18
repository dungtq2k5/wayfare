import { Module } from '@nestjs/common';
import { SocketEmitter } from '@wayfare/nest-common';
import type { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.module';
import { NotificationsGrpcController } from './notifications-grpc.controller';
import { NotificationsService, SOCKET_EMITTER } from './notifications.service';

/**
 * The notification feed and its frames, over the Redis the gateway's socket adapter reads
 * (conventions §7.4).
 */
@Module({
  controllers: [NotificationsGrpcController],
  providers: [
    {
      provide: SOCKET_EMITTER,
      inject: [REDIS],
      useFactory: (redis: Redis) => new SocketEmitter(redis),
    },
    NotificationsService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
