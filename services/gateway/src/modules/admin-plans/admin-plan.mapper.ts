import type { AdminPlan, ApplyResult, Entitlements } from '@wayfare/contracts';
import {
  analyticsLevelProto,
  billingIntervalProto,
  narrationLanguageScopeProto,
} from '@wayfare/contracts/grpc';
import type { billingGrpc } from '@wayfare/contracts/grpc';
import { toEntitlements as toGrants, toPlanPrice } from '../billing/billing.mapper';
import type { CreatePlanDto, RegisterPriceDto, UpdatePlanDto } from './dto/admin-plan.dto';

/** A grant set on the wire. */
export function toEntitlements(grants: Entitlements): billingGrpc.Entitlements {
  return {
    maxPlaces: grants.maxPlaces,
    autoNarration: grants.autoNarration,
    narrationLanguageScope: narrationLanguageScopeProto.toProto(grants.narrationLanguageScope),
    maxPhotosPerPlace: grants.maxPhotosPerPlace,
    maxMenuItemsPerPlace: grants.maxMenuItemsPerPlace,
    discoveryBoostSlots: grants.discoveryBoostSlots,
    aiCreditsPerDay: grants.aiCreditsPerDay,
    analyticsLevel: analyticsLevelProto.toProto(grants.analyticsLevel),
    canSellVouchers: grants.canSellVouchers,
    ...(grants.voucherCommissionBps === null
      ? {}
      : { voucherCommissionBps: grants.voucherCommissionBps }),
  };
}

/** A catalogue plan. */
export function toAdminPlan(plan: billingGrpc.AdminPlan | undefined): AdminPlan {
  if (plan === undefined) throw new Error('billing sent no plan');
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    stripeProductId: plan.stripeProductId ?? null,
    isActive: plan.isActive,
    sortOrder: plan.sortOrder,
    grants: toGrants(plan.grants),
    prices: plan.prices.map(toPlanPrice),
    subscriberCount: plan.subscriberCount,
  };
}

/** The `CreatePlan` request. */
export function toCreatePlanRequest(body: CreatePlanDto): billingGrpc.CreatePlanRequest {
  return {
    code: body.code,
    name: body.name,
    sortOrder: body.sortOrder,
    ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
    grants: toEntitlements(body.grants),
  };
}

/** The `UpdatePlan` request: only what the body carries. */
export function toUpdatePlanRequest(
  planId: string,
  body: UpdatePlanDto,
): billingGrpc.UpdatePlanRequest {
  return {
    planId,
    ...(body.name === undefined ? {} : { name: body.name }),
    ...(body.sortOrder === undefined ? {} : { sortOrder: body.sortOrder }),
    ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
    grants: body.grants === undefined ? undefined : toEntitlements(body.grants),
  };
}

/** The `RegisterPrice` request. */
export function toRegisterPriceRequest(
  planId: string,
  body: RegisterPriceDto,
): billingGrpc.RegisterPriceRequest {
  return {
    planId,
    stripePriceId: body.stripePriceId,
    billingInterval: billingIntervalProto.toProto(body.billingInterval),
  };
}

/** An apply's result; an absent count becomes `null` (conventions §6.3). */
export function toApplyResult(result: billingGrpc.ApplyPlanResponse): ApplyResult {
  return {
    dryRun: result.dryRun,
    affected: result.affected,
    skippedPinned: result.skippedPinned,
    failed: result.failed,
    wouldUnpublishPlaces: result.wouldUnpublishPlaces ?? null,
    wouldEndBoosts: result.wouldEndBoosts,
    accounts: result.accounts.map((account) => ({
      billingAccountId: account.billingAccountId,
      ownerUserId: account.ownerUserId,
      changed: account.changed,
      wouldUnpublishPlaces: account.wouldUnpublishPlaces ?? null,
      failed: account.failed,
    })),
  };
}
