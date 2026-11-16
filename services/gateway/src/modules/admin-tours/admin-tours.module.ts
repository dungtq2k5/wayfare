import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { AdminToursController } from './admin-tours.controller';
import { AdminToursService } from './admin-tours.service';

/** `/admin/tours` (api-endpoints-plan §3.6). */
@Module({
  imports: [CatalogModule],
  controllers: [AdminToursController],
  providers: [AdminToursService],
})
export class AdminToursModule {}
