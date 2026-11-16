import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { GRPC_PACKAGES } from '@wayfare/contracts';
import { GRPC_LOADER_OPTIONS, protoPaths } from '@wayfare/nest-common';
import type { GatewayConfig } from '../../config/env.schema';
import { ANALYTICS_GRPC, AnalyticsServiceGrpcClient } from './analytics-service-grpc.client';

/** The one connection to analytics, shared by the tourist's writes and the dashboards' reads. */
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: ANALYTICS_GRPC,
        inject: [ConfigService],
        useFactory: (config: GatewayConfig) => {
          // Read into a local: inside the union-typed options, `get`'s return type would be inferred as any.
          const url = config.get('ANALYTICS_GRPC_URL', { infer: true });
          return {
            transport: Transport.GRPC,
            options: {
              package: GRPC_PACKAGES.analytics,
              protoPath: protoPaths('analytics'),
              url,
              loader: GRPC_LOADER_OPTIONS,
            },
          };
        },
      },
    ]),
  ],
  providers: [AnalyticsServiceGrpcClient],
  exports: [AnalyticsServiceGrpcClient],
})
export class AnalyticsClientModule {}
