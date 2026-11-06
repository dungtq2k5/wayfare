import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { ToursController } from './tours.controller';
import { ToursService } from './tours.service';

/** `/tours` (api-endpoints-plan §2.2). */
@Module({
  imports: [CatalogModule],
  controllers: [ToursController],
  providers: [ToursService],
})
export class ToursModule {}
