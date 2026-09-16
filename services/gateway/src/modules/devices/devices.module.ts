import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { GRPC_PACKAGES } from '@wayfare/contracts';
import { GRPC_LOADER_OPTIONS, protoPaths } from '@wayfare/nest-common';
import { AppConfig } from '../../config/env.schema';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { IDENTITY_GRPC, IdentityServiceGrpcClient } from './identity-service-grpc.client';

/** `/devices` routes, backed by `identity.DeviceService`. */
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: IDENTITY_GRPC,
        inject: [AppConfig],
        useFactory: (config: AppConfig) => ({
          transport: Transport.GRPC,
          options: {
            package: GRPC_PACKAGES.identity,
            protoPath: protoPaths('identity'),
            url: config.IDENTITY_GRPC_URL,
            loader: GRPC_LOADER_OPTIONS,
          },
        }),
      },
    ]),
  ],
  controllers: [DevicesController],
  providers: [DevicesService, IdentityServiceGrpcClient],
})
export class DevicesModule {}
