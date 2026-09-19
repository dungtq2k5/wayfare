import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { billingGrpc } from '@wayfare/contracts/grpc';
import { GrpcServiceCaller, SYSTEM_ORIGIN } from '@wayfare/nest-common';

/** Injection token for billing's gRPC connection. */
export const BILLING_GRPC = Symbol('BILLING_GRPC');

/**
 * billing as narration calls it (api-endpoints-plan §12.2): an owner's entitlements, for a Venue's
 * on-demand language check. Called with a system context; returns proto types only, and the caller
 * decides what a failure means — it fails closed.
 */
@Injectable()
export class BillingServiceGrpcClient implements OnModuleInit {
  readonly entitlements: GrpcServiceCaller<billingGrpc.EntitlementServiceClient>;

  constructor(@Inject(BILLING_GRPC) grpc: ClientGrpc) {
    this.entitlements = new GrpcServiceCaller(grpc, billingGrpc.ENTITLEMENT_SERVICE_NAME);
  }

  onModuleInit(): void {
    this.entitlements.init();
  }

  getEntitlements(ownerUserId: string): Promise<billingGrpc.GetEntitlementsResponse> {
    return this.entitlements.call(
      'getEntitlements',
      { ownerUserId },
      { kind: 'anonymous', origin: SYSTEM_ORIGIN },
    );
  }
}
