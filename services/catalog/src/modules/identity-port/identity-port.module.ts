import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { GRPC_PACKAGES } from '@wayfare/contracts';
import { GRPC_LOADER_OPTIONS, protoPaths } from '@wayfare/nest-common';
import type { CatalogConfig } from '../../config/env.schema';
import { IdentityPortService } from './identity-port.service';
import { IDENTITY_GRPC, IdentityServiceGrpcClient } from './identity-service-grpc.client';

/** catalog's port to identity, over its one connection (api-endpoints-plan §12.2). */
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: IDENTITY_GRPC,
        inject: [ConfigService],
        useFactory: (config: CatalogConfig) => {
          // Read into a local: inside the union-typed options, `get`'s return type would be inferred as any.
          const url = config.get('IDENTITY_GRPC_URL', { infer: true });
          return {
            transport: Transport.GRPC,
            options: {
              package: GRPC_PACKAGES.identity,
              protoPath: protoPaths('identity'),
              url,
              loader: GRPC_LOADER_OPTIONS,
            },
          };
        },
      },
    ]),
  ],
  providers: [IdentityServiceGrpcClient, IdentityPortService],
  exports: [IdentityPortService],
})
export class IdentityPortModule {}
