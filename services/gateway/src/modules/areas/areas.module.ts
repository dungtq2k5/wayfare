import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { AreasController } from './areas.controller';
import { AreasService } from './areas.service';

/** `/areas`, backed by `catalog.PlaceQueryService`. */
@Module({
  imports: [CatalogModule],
  controllers: [AreasController],
  providers: [AreasService],
})
export class AreasModule {}
