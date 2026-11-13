import { Module } from '@nestjs/common';
import { AnalyticsClientModule } from '../analytics-client/analytics-client.module';
import { CatalogModule } from '../catalog/catalog.module';
import { AdminAnalyticsController } from './admin-analytics.controller';
import { AdminAnalyticsService } from './admin-analytics.service';

/** `/admin/analytics` — the dashboards' reads, composed with catalog. */
@Module({
  imports: [AnalyticsClientModule, CatalogModule],
  controllers: [AdminAnalyticsController],
  providers: [AdminAnalyticsService],
})
export class AdminAnalyticsModule {}
