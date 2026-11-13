import { Module } from '@nestjs/common';
import { AnalyticsClientModule } from '../analytics-client/analytics-client.module';
import { CatalogModule } from '../catalog/catalog.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

/** The tourist's analytics routes: consent, events, and the runtime lane. */
@Module({
  imports: [AnalyticsClientModule, CatalogModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
