import { Module } from '@nestjs/common';
import { InsightsGrpcController } from './insights-grpc.controller';
import { InsightsService } from './insights.service';

/** What the analytics dashboards read from catalog (rdm-spec C-15, api-endpoints-plan §7). */
@Module({ controllers: [InsightsGrpcController], providers: [InsightsService] })
export class InsightsModule {}
