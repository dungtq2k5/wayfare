import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { QrController } from './qr.controller';
import { QrService } from './qr.service';

/** The sticker entry point, backed by `catalog.PlaceQueryService`. */
@Module({
  imports: [CatalogModule],
  controllers: [QrController],
  providers: [QrService],
})
export class QrModule {}
