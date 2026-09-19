import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { billingGrpc } from '@wayfare/contracts/grpc';
import { GrpcServiceCaller } from '@wayfare/nest-common';

/** Injection token for billing's gRPC connection. */
export const BILLING_GRPC = Symbol('BILLING_GRPC');

/** billing as catalog calls it (api-endpoints-plan §12.2): one caller per stub, proto types only. */
@Injectable()
export class BillingServiceGrpcClient implements OnModuleInit {
  readonly seller: GrpcServiceCaller<billingGrpc.SellerServiceClient>;

  constructor(@Inject(BILLING_GRPC) grpc: ClientGrpc) {
    this.seller = new GrpcServiceCaller(grpc, billingGrpc.SELLER_SERVICE_NAME);
  }

  onModuleInit(): void {
    this.seller.init();
  }
}
