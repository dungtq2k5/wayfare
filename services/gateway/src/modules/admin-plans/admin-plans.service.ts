import { Injectable } from '@nestjs/common';
import type { AdminPlan, ApplyResult } from '@wayfare/contracts';
import type { AccountContext } from '@wayfare/nest-common';
import { BillingServiceGrpcClient } from '../billing/billing-service-grpc.client';
import {
  toAdminPlan,
  toApplyResult,
  toCreatePlanRequest,
  toRegisterPriceRequest,
  toUpdatePlanRequest,
} from './admin-plan.mapper';
import type { CreatePlanDto, RegisterPriceDto, UpdatePlanDto } from './dto/admin-plan.dto';

/** `/admin/plans`, backed by `billing.PlanAdminService`. */
@Injectable()
export class AdminPlansService {
  constructor(private readonly billing: BillingServiceGrpcClient) {}

  async list(context: AccountContext): Promise<AdminPlan[]> {
    const response = await this.billing.plans.call('listPlans', {}, context);
    return response.plans.map(toAdminPlan);
  }

  async create(context: AccountContext, body: CreatePlanDto): Promise<{ plan: AdminPlan }> {
    const response = await this.billing.plans.call(
      'createPlan',
      toCreatePlanRequest(body),
      context,
    );
    return { plan: toAdminPlan(response.plan) };
  }

  async update(
    context: AccountContext,
    planId: string,
    body: UpdatePlanDto,
  ): Promise<{ plan: AdminPlan }> {
    const response = await this.billing.plans.call(
      'updatePlan',
      toUpdatePlanRequest(planId, body),
      context,
    );
    return { plan: toAdminPlan(response.plan) };
  }

  async registerPrice(
    context: AccountContext,
    planId: string,
    body: RegisterPriceDto,
  ): Promise<{ plan: AdminPlan }> {
    const response = await this.billing.plans.call(
      'registerPrice',
      toRegisterPriceRequest(planId, body),
      context,
    );
    return { plan: toAdminPlan(response.plan) };
  }

  async apply(context: AccountContext, planId: string, dryRun: boolean): Promise<ApplyResult> {
    return toApplyResult(await this.billing.plans.call('applyPlan', { planId, dryRun }, context));
  }

  async retire(context: AccountContext, planId: string): Promise<void> {
    await this.billing.plans.call('retirePlan', { planId }, context);
  }
}
