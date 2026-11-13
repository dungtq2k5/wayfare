import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { GRPC_PACKAGES } from '@wayfare/contracts';
import { GRPC_LOADER_OPTIONS, protoPaths } from '@wayfare/nest-common';
import type { NarrationConfig } from '../../config/env.schema';
import { BILLING_GRPC, BillingServiceGrpcClient } from './billing-service-grpc.client';

/** The one connection to billing (api-endpoints-plan §12.2). */
@Global()
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: BILLING_GRPC,
        inject: [ConfigService],
        useFactory: (config: NarrationConfig) => {
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
  providers: [BillingServiceGrpcClient],
  exports: [BillingServiceGrpcClient],
})
export class BillingModule {}
