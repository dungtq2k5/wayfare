import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { GRPC_PACKAGES } from '@wayfare/contracts';
import { GRPC_LOADER_OPTIONS, protoPaths } from '@wayfare/nest-common';
import type { GatewayConfig } from '../../config/env.schema';
import { NARRATION_GRPC, NarrationServiceGrpcClient } from './narration-service-grpc.client';

/** The one connection to narration, shared by the tourist routes, the monitor and the socket. */
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: NARRATION_GRPC,
        inject: [ConfigService],
        useFactory: (config: GatewayConfig) => {
          // Read into a local: inside the union-typed options, `get`'s return type would be inferred as any.
          const url = config.get('NARRATION_GRPC_URL', { infer: true });
          return {
            transport: Transport.GRPC,
            options: {
              package: GRPC_PACKAGES.narration,
              protoPath: protoPaths('narration'),
              url,
              loader: GRPC_LOADER_OPTIONS,
            },
          };
        },
      },
    ]),
  ],
  providers: [NarrationServiceGrpcClient],
  exports: [NarrationServiceGrpcClient],
})
export class NarrationClientModule {}
