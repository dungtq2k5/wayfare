import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { GRPC_PACKAGES } from '@wayfare/contracts';
import { GRPC_LOADER_OPTIONS, protoPaths } from '@wayfare/nest-common';
import type { BillingConfig } from '../../config/env.schema';
import { CATALOG_GRPC, CatalogServiceGrpcClient } from './catalog-service-grpc.client';

/** The one connection to catalog (api-endpoints-plan §12.2). */
@Global()
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: CATALOG_GRPC,
        inject: [ConfigService],
        useFactory: (config: BillingConfig) => {
          // Read into a local: inside the union-typed options, `get`'s return type would be inferred as any.
          const url = config.get('CATALOG_GRPC_URL', { infer: true });
          return {
            transport: Transport.GRPC,
            options: {
              package: GRPC_PACKAGES.catalog,
              protoPath: protoPaths('catalog'),
              url,
              loader: GRPC_LOADER_OPTIONS,
            },
          };
        },
      },
    ]),
  ],
  providers: [CatalogServiceGrpcClient],
  exports: [CatalogServiceGrpcClient],
})
export class CatalogModule {}
