import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { GRPC_PACKAGES } from '@wayfare/contracts';
import { GRPC_LOADER_OPTIONS, protoPaths } from '@wayfare/nest-common';
import type { BillingConfig } from '../../config/env.schema';
import { IDENTITY_GRPC, IdentityServiceGrpcClient } from './identity-service-grpc.client';

/** The one connection to identity (api-endpoints-plan §12.2). */
@Global()
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: IDENTITY_GRPC,
        inject: [ConfigService],
        useFactory: (config: BillingConfig) => {
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
  providers: [IdentityServiceGrpcClient],
  exports: [IdentityServiceGrpcClient],
})
export class IdentityModule {}
