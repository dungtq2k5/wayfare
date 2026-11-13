import { Module } from '@nestjs/common';
import { SystemCatalogService } from './system-catalog.service';

/** Mirrors the code's permission catalogue and system roles at boot. */
@Module({
  providers: [SystemCatalogService],
})
export class SystemCatalogModule {}
