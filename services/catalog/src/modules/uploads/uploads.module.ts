import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CatalogConfig } from '../../config/env.schema';
import { IMAGE_PROCESSOR } from '../../providers/image/image-processor';
import { SharpImageProcessor } from '../../providers/image/sharp.image-processor';
import { GcsStorageProvider } from '@wayfare/nest-common/storage';
import { STORAGE_PROVIDER } from '@wayfare/nest-common/storage';
import { UploadsGrpcController } from './uploads-grpc.controller';
import { UploadsService } from './uploads.service';

/** Signed uploads and the media providers behind them (api-endpoints-plan §3.2, ADR 0022). */
@Module({
  controllers: [UploadsGrpcController],
  providers: [
    UploadsService,
    {
      provide: STORAGE_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: CatalogConfig) =>
        new GcsStorageProvider({
          bucket: config.get('GCS_BUCKET_MEDIA', { infer: true }),
          apiEndpoint: config.get('GCS_API_ENDPOINT', { infer: true }),
          keyFilename: config.get('GOOGLE_APPLICATION_CREDENTIALS', { infer: true }),
        }),
    },
    { provide: IMAGE_PROCESSOR, useClass: SharpImageProcessor },
  ],
  exports: [UploadsService, STORAGE_PROVIDER],
})
export class UploadsModule {}
