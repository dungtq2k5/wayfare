import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

/** `/uploads`, backed by `catalog.UploadService`. */
@Module({
  imports: [CatalogModule],
  controllers: [UploadsController],
  providers: [UploadsService],
})
export class UploadsModule {}
