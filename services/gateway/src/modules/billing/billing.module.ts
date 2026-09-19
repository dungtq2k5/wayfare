import { Global, Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { GRPC_PACKAGES } from '@wayfare/contracts';
import {
  GRPC_LOADER_OPTIONS,
  IDEMPOTENCY_REDIS,
  IdempotencyInterceptor,
  protoPaths,
} from '@wayfare/nest-common';
import { ConfigService } from '@nestjs/config';
import type { GatewayConfig } from '../../config/env.schema';
import { REDIS } from '../ops/redis.module';
import { BILLING_GRPC, BillingServiceGrpcClient } from './billing-service-grpc.client';

/**
 * The one connection to billing, shared by every route billing backs — and the idempotency store
 * its ⟳ routes use, over the gateway's Redis (api-endpoints-plan §0.8).
 */
@Global()
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: BILLING_GRPC,
        inject: [ConfigService],
        useFactory: (config: GatewayConfig) => {
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
  providers: [
    BillingServiceGrpcClient,
    { provide: IDEMPOTENCY_REDIS, useExisting: REDIS },
    IdempotencyInterceptor,
  ],
  exports: [BillingServiceGrpcClient, IDEMPOTENCY_REDIS, IdempotencyInterceptor],
})
export class BillingModule {}
