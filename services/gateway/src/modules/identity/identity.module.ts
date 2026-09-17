import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { GRPC_PACKAGES } from '@wayfare/contracts';
import { GRPC_LOADER_OPTIONS, protoPaths } from '@wayfare/nest-common';
import { ConfigService } from '@nestjs/config';
import type { GatewayConfig } from '../../config/env.schema';
import { IDENTITY_GRPC, IdentityServiceGrpcClient } from './identity-service-grpc.client';
import { IdentityService } from './identity.service';

/** The one connection to identity, shared by every route identity backs. */
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: IDENTITY_GRPC,
        inject: [ConfigService],
        useFactory: (config: GatewayConfig) => {
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
  providers: [IdentityServiceGrpcClient, IdentityService],
  exports: [IdentityServiceGrpcClient, IdentityService],
})
export class IdentityModule {}
