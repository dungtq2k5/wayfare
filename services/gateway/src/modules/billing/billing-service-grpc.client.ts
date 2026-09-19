import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { billingGrpc } from '@wayfare/contracts/grpc';
import { GrpcServiceCaller } from '@wayfare/nest-common';

/** Injection token for billing's gRPC connection. */
export const BILLING_GRPC = Symbol('BILLING_GRPC');

/**
 * billing as the gateway calls it: one caller per stub (conventions §6.2). Returns proto types only;
 * the deadline, caller metadata and down-versus-slow mapping live in each caller.
 */
@Injectable()
export class BillingServiceGrpcClient implements OnModuleInit {
  readonly billing: GrpcServiceCaller<billingGrpc.BillingServiceClient>;
  readonly plans: GrpcServiceCaller<billingGrpc.PlanAdminServiceClient>;
  readonly accounts: GrpcServiceCaller<billingGrpc.AccountAdminServiceClient>;
  readonly events: GrpcServiceCaller<billingGrpc.BillingEventAdminServiceClient>;
  readonly webhooks: GrpcServiceCaller<billingGrpc.BillingWebhookServiceClient>;

  constructor(@Inject(BILLING_GRPC) grpc: ClientGrpc) {
    this.billing = new GrpcServiceCaller(grpc, billingGrpc.BILLING_SERVICE_NAME);
    this.plans = new GrpcServiceCaller(grpc, billingGrpc.PLAN_ADMIN_SERVICE_NAME);
    this.accounts = new GrpcServiceCaller(grpc, billingGrpc.ACCOUNT_ADMIN_SERVICE_NAME);
    this.events = new GrpcServiceCaller(grpc, billingGrpc.BILLING_EVENT_ADMIN_SERVICE_NAME);
    this.webhooks = new GrpcServiceCaller(grpc, billingGrpc.BILLING_WEBHOOK_SERVICE_NAME);
  }

  onModuleInit(): void {
    this.billing.init();
    this.plans.init();
    this.accounts.init();
    this.events.init();
    this.webhooks.init();
  }
}
