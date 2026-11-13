import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GcsStorageProvider, STORAGE_PROVIDER } from '@wayfare/nest-common/storage';
import type { NarrationConfig } from '../../config/env.schema';

/** The media bucket: audio is written to `audio/<cache_key>.mp3` beside the photos (architecture §3.6). */
@Global()
@Module({
  providers: [
    {
      provide: STORAGE_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: NarrationConfig) =>
        new GcsStorageProvider({
          bucket: config.get('GCS_BUCKET_MEDIA', { infer: true }),
          apiEndpoint: config.get('GCS_API_ENDPOINT', { infer: true }),
          keyFilename: config.get('GOOGLE_APPLICATION_CREDENTIALS', { infer: true }),
        }),
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
