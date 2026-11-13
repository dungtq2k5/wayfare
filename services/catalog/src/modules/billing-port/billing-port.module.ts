import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { GRPC_PACKAGES } from '@wayfare/contracts';
import { GRPC_LOADER_OPTIONS, protoPaths } from '@wayfare/nest-common';
import type { CatalogConfig } from '../../config/env.schema';
import { BillingPortService } from './billing-port.service';
import { BILLING_GRPC, BillingServiceGrpcClient } from './billing-service-grpc.client';

/** catalog's port to billing, over its one connection (api-endpoints-plan §12.2). */
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: BILLING_GRPC,
        inject: [ConfigService],
        useFactory: (config: CatalogConfig) => {
          // Read into a local: inside the union-typed options, `get`'s return type would be inferred as any.
          const url = config.get('BILLING_GRPC_URL', { infer: true });
          return {
            transport: Transport.GRPC,
            options: {
              package: GRPC_PACKAGES.billing,
              protoPath: protoPaths('billing'),
              url,
              loader: GRPC_LOADER_OPTIONS,
            },
          };
        },
      },
    ]),
  ],
  providers: [BillingServiceGrpcClient, BillingPortService],
  exports: [BillingPortService],
})
export class BillingPortModule {}
