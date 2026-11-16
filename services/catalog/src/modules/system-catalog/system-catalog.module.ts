import { Module } from '@nestjs/common';
import { SystemCatalogService } from './system-catalog.service';

/** Inserts the code's category registry at boot. */
@Module({
  providers: [SystemCatalogService],
})
export class SystemCatalogModule {}
