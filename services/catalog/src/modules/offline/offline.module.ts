import { Inject, Injectable, Module } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { CatalogConfig } from '../../config/env.schema';
import { PlaceQueriesModule } from '../place-queries/place-queries.module';
import { SyncModule } from '../sync/sync.module';
import { UploadsModule } from '../uploads/uploads.module';
import { OfflineGrpcController } from './offline-grpc.controller';
import { MANIFEST_CACHE, OfflineService } from './offline.service';

/** Closes the manifest cache's Redis client at shutdown. */
@Injectable()
export class ManifestCacheLifecycle implements OnApplicationShutdown {
  constructor(@Inject(MANIFEST_CACHE) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}

/**
 * The offline pack (api-endpoints-plan §2.4). The manifest cache is only the fast path: an
 * unreachable Redis computes the manifest again, never fails it.
 */
@Module({
  imports: [PlaceQueriesModule, SyncModule, UploadsModule],
  controllers: [OfflineGrpcController],
  providers: [
    OfflineService,
    {
      provide: MANIFEST_CACHE,
      inject: [ConfigService],
      useFactory: (config: CatalogConfig) =>
        new Redis(config.get('REDIS_URL', { infer: true }), {
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectionName: 'catalog-offline',
        }),
    },
    ManifestCacheLifecycle,
  ],
})
export class OfflineModule {}
