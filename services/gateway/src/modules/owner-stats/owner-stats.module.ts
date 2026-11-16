import { Module } from '@nestjs/common';
import { AnalyticsClientModule } from '../analytics-client/analytics-client.module';
import { CatalogModule } from '../catalog/catalog.module';
import { OwnerStatsController } from './owner-stats.controller';
import { OwnerStatsService } from './owner-stats.service';

/** `/owner/stats` — My stats, composed from catalog, analytics and billing. */
@Module({
  imports: [AnalyticsClientModule, CatalogModule],
  controllers: [OwnerStatsController],
  providers: [OwnerStatsService],
})
export class OwnerStatsModule {}
