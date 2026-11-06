import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { CodesController } from './codes.controller';
import { CodesService } from './codes.service';

/** `/codes/:publicCode` (api-endpoints-plan §2.1). */
@Module({
  imports: [CatalogModule],
  controllers: [CodesController],
  providers: [CodesService],
})
export class CodesModule {}
