import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { billingGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { PlansService } from './plans.service';

/** `wayfare.billing.PlanAdminService` — unpack the caller, delegate once. */
@Controller()
@billingGrpc.PlanAdminServiceControllerMethods()
export class PlansGrpcController implements billingGrpc.PlanAdminServiceController {
  constructor(private readonly plans: PlansService) {}

  listPlans(
    _request: billingGrpc.ListPlansRequest,
    metadata?: Metadata,
  ): Promise<billingGrpc.ListPlansResponse> {
    return this.plans.listPlans(unpackCallerContext(metadata));
  }

  createPlan(
    request: billingGrpc.CreatePlanRequest,
    metadata?: Metadata,
  ): Promise<billingGrpc.CreatePlanResponse> {
    return this.plans.createPlan(request, unpackCallerContext(metadata));
  }

  updatePlan(
    request: billingGrpc.UpdatePlanRequest,
    metadata?: Metadata,
  ): Promise<billingGrpc.UpdatePlanResponse> {
    return this.plans.updatePlan(request, unpackCallerContext(metadata));
  }

  registerPrice(
    request: billingGrpc.RegisterPriceRequest,
    metadata?: Metadata,
  ): Promise<billingGrpc.RegisterPriceResponse> {
    return this.plans.registerPrice(request, unpackCallerContext(metadata));
  }

  applyPlan(
    request: billingGrpc.ApplyPlanRequest,
    metadata?: Metadata,
  ): Promise<billingGrpc.ApplyPlanResponse> {
    return this.plans.applyPlan(request, unpackCallerContext(metadata));
  }

  retirePlan(
    request: billingGrpc.RetirePlanRequest,
    metadata?: Metadata,
  ): Promise<billingGrpc.RetirePlanResponse> {
    return this.plans.retirePlan(request, unpackCallerContext(metadata));
  }
}
