import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { GRPC_PACKAGES } from '@wayfare/contracts';
import { AccountTokenVerifier, GRPC_LOADER_OPTIONS, protoPaths } from '@wayfare/nest-common';
import type { Redis } from 'ioredis';
import { ConfigService } from '@nestjs/config';
import type { GatewayConfig } from '../../config/env.schema';
import { REDIS } from '../ops/redis.module';
import { IDENTITY_GRPC, IdentityServiceGrpcClient } from './identity-service-grpc.client';
import { IdentityService } from './identity.service';

/** The one connection to identity, shared by every route identity backs, and the token checks. */
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
  providers: [
    IdentityServiceGrpcClient,
    IdentityService,
    // The account-token checks shared by the HTTP middleware and the socket (api-endpoints-plan §0.1).
    {
      provide: AccountTokenVerifier,
      inject: [ConfigService, REDIS, IdentityService],
      useFactory: (config: GatewayConfig, redis: Redis, identity: IdentityService) =>
        new AccountTokenVerifier({
          publicKeys: config.get('JWT_PUBLIC_KEYS', { infer: true }),
          redis,
          cutoffSource: identity,
        }),
    },
  ],
  exports: [IdentityServiceGrpcClient, IdentityService, AccountTokenVerifier],
})
export class IdentityModule {}
