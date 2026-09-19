import { Injectable, Logger } from '@nestjs/common';
import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  BillingInterval,
  FREE_PLAN_CODE,
  sameGrants,
  zPlanInput,
  zPlanUpdateInput,
  zRegisterPriceInput,
  zUuidV7,
} from '@wayfare/contracts';
import type { Entitlements } from '@wayfare/contracts';
import { billingIntervalProto } from '@wayfare/contracts/grpc';
import type { billingGrpc } from '@wayfare/contracts/grpc';
import {
  isUniqueConstraintViolation,
  OutboxService,
  parseRpcRequest,
  requireAccountContext,
  rpcError,
} from '@wayfare/nest-common';
import type { AccountContext, RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client';
import {
  PaymentsProvider,
  PaymentsUnavailableError,
} from '../../providers/payments/payments-provider';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import { billingAuditRecord } from '../entitlements/domain/billing-audit';
import type { BillingAuditOrigin } from '../entitlements/domain/billing-audit';
import { grantColumns, grantsOf } from '../entitlements/domain/grants-write';
import { BILLING_ACCOUNT_SELECT, fromProtoEntitlements } from '../entitlements/entitlement.mapper';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { PrismaService } from '../prisma/prisma.service';
import { ADMIN_PLAN_SELECT, toAdminPlan } from './plan.mapper';
import type { AdminPlanRow } from './plan.mapper';

const planIdField = z.object({ planId: zUuidV7 });

/** The Stripe interval a registered price must recur at. */
const STRIPE_INTERVAL: Readonly<Record<BillingInterval, string>> = {
  [BillingInterval.MONTH]: 'month',
  [BillingInterval.YEAR]: 'year',
};

/** A refusal of a registration, named by the field that caused it. */
const invalid = (path: string, code: string) =>
  rpcError('VALIDATION_FAILED', { issues: [{ path, code }] });

/** Who registers a price: an admin through the route, or the development seed. */
export interface PriceRegistrar {
  readonly actor:
    | { readonly type: AuditActorType.USER; readonly userId: string }
    | { readonly type: AuditActorType.SYSTEM };
  readonly origin: BillingAuditOrigin;
}

/**
 * The plan catalogue (api-endpoints-plan §6.1, rdm-spec B-1, B-2). Editing a plan never touches its
 * subscribers: `ApplyPlan` is the explicit fan-out, with a dry run from the same code path.
 */
@Injectable()
export class PlansService {
  private readonly logger = new Logger(PlansService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly payments: PaymentsProvider,
    private readonly entitlements: EntitlementsService,
    private readonly catalog: CatalogServiceGrpcClient,
  ) {}

  /** Every live plan, with every price and its subscriber count (deactivated owners included). */
  async listPlans(context: RequestContext): Promise<billingGrpc.ListPlansResponse> {
    requireAccountContext(context);
    const rows = await this.prisma.plan.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      select: ADMIN_PLAN_SELECT,
    });
    const counts = await this.subscriberCounts(rows.map((row) => row.id));
    return { plans: rows.map((row) => toAdminPlan(row, counts.get(row.id) ?? 0)) };
  }

  /** A new plan: every grant stated, each within its ceiling (rdm-spec B-1). */
  async createPlan(
    request: billingGrpc.CreatePlanRequest,
    context: RequestContext,
  ): Promise<billingGrpc.CreatePlanResponse> {
    const actor = requireAccountContext(context);
    const grants = request.grants ?? undefined;
    const input = parseRpcRequest(zPlanInput, {
      code: request.code,
      name: request.name,
      sortOrder: request.sortOrder,
      isActive: request.isActive ?? undefined,
      grants: grants === undefined ? undefined : fromProtoEntitlements(grants),
    });
    const now = new Date();
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.plan.create({
          data: {
            code: input.code,
            name: input.name,
            sortOrder: input.sortOrder,
            isActive: input.isActive ?? true,
            ...grantColumns(input.grants),
          },
          select: ADMIN_PLAN_SELECT,
        });
        await this.audit(tx, actor, AuditAction.PLAN_CREATED, created.id, now, {
          after: { code: created.code, grants: input.grants },
        });
        return created;
      });
      return { plan: toAdminPlan(row, 0) };
    } catch (error) {
      if (isUniqueConstraintViolation(error)) throw invalid('/code', 'taken');
      throw error;
    }
  }

  /** The catalogue row only; subscribers are untouched until apply. Grants, when sent, are whole. */
  async updatePlan(
    request: billingGrpc.UpdatePlanRequest,
    context: RequestContext,
  ): Promise<billingGrpc.UpdatePlanResponse> {
    const actor = requireAccountContext(context);
    const { planId } = parseRpcRequest(planIdField, request);
    const grants = request.grants ?? undefined;
    const input = parseRpcRequest(zPlanUpdateInput, {
      name: request.name ?? undefined,
      sortOrder: request.sortOrder ?? undefined,
      isActive: request.isActive ?? undefined,
      grants: grants === undefined ? undefined : fromProtoEntitlements(grants),
    });
    const now = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.livePlan(tx, planId);
      const updated = await tx.plan.update({
        where: { id: current.id },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
          ...(input.grants === undefined ? {} : grantColumns(input.grants)),
        },
        select: ADMIN_PLAN_SELECT,
      });
      await this.audit(tx, actor, AuditAction.PLAN_UPDATED, current.id, now, {
        after: { code: current.code, grants: grantsOf(updated) },
      });
      return updated;
    });
    const counts = await this.subscriberCounts([row.id]);
    return { plan: toAdminPlan(row, counts.get(row.id) ?? 0) };
  }

  /** Registers a Stripe Price: the route's handler, and the development seed's. */
  async registerPrice(
    request: billingGrpc.RegisterPriceRequest,
    context: RequestContext,
  ): Promise<billingGrpc.RegisterPriceResponse> {
    const actor = requireAccountContext(context);
    const { planId } = parseRpcRequest(planIdField, request);
    const input = parseRpcRequest(zRegisterPriceInput, {
      stripePriceId: request.stripePriceId,
      billingInterval: billingIntervalProto.fromProto(request.billingInterval),
    });
    const row = await this.register(planId, input.stripePriceId, input.billingInterval, {
      actor: { type: AuditActorType.USER, userId: actor.userId },
      origin: actor.origin,
    });
    const counts = await this.subscriberCounts([row.id]);
    return { plan: toAdminPlan(row, counts.get(row.id) ?? 0) };
  }

  /**
   * Reads the price from Stripe — active, recurring at the interval, in USD, on the plan's Product
   * (a plan with none takes the price's) — and records it, deactivating the interval's previous
   * active price in the same transaction. The amount is Stripe's, never typed.
   */
  async register(
    planId: string,
    stripePriceId: string,
    interval: BillingInterval,
    by: PriceRegistrar,
  ): Promise<AdminPlanRow> {
    const plan = await this.livePlan(this.prisma, planId);
    if (plan.code === FREE_PLAN_CODE)
      throw rpcError('INVALID_STATE', { status: 'ASSIGNED_NOT_SOLD' });
    let price;
    try {
      price = await this.payments.retrievePrice(stripePriceId);
    } catch (error) {
      if (error instanceof PaymentsUnavailableError) throw rpcError('UPSTREAM_UNAVAILABLE');
      throw error;
    }
    if (!price.active) throw invalid('/stripePriceId', 'inactive');
    if (price.recurringInterval !== STRIPE_INTERVAL[interval]) {
      throw invalid('/billingInterval', 'interval_mismatch');
    }
    if (price.currency.toLowerCase() !== 'usd') throw invalid('/stripePriceId', 'currency');
    if (price.unitAmount === null || price.unitAmount <= 0) {
      throw invalid('/stripePriceId', 'amount');
    }
    if (plan.stripeProductId !== null && plan.stripeProductId !== price.productId) {
      throw invalid('/stripePriceId', 'product_mismatch');
    }
    const amountMinor = price.unitAmount;
    const now = new Date();
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (plan.stripeProductId === null) {
          await tx.plan.update({
            where: { id: plan.id },
            data: { stripeProductId: price.productId },
            select: { id: true },
          });
        }
        await tx.planPrice.updateMany({
          where: { planId: plan.id, billingInterval: interval, isActive: true },
          data: { isActive: false },
        });
        await tx.planPrice.create({
          data: {
            planId: plan.id,
            stripePriceId: price.id,
            billingInterval: interval,
            amountMinor,
          },
          select: { id: true },
        });
        await this.outbox.add(
          tx,
          AUDIT_RECORD,
          billingAuditRecord({
            actor: by.actor,
            action: AuditAction.PLAN_PRICE_REGISTERED,
            resource: { type: AuditResourceType.PLAN, id: plan.id },
            metadata: { after: { billingInterval: interval, amountMinor } },
            origin: by.origin,
            now,
          }),
        );
        return tx.plan.findUniqueOrThrow({ where: { id: plan.id }, select: ADMIN_PLAN_SELECT });
      });
    } catch (error) {
      // A price already registered, or a Product another plan holds.
      if (isUniqueConstraintViolation(error)) throw invalid('/stripePriceId', 'taken');
      throw error;
    }
  }

  /**
   * Writes the plan's grants onto every account whose effective plan it is and that is not pinned,
   * one transaction per account, so one failure does not undo the others. A dry run writes nothing
   * and returns the same projection, from the same derivation.
   */
  async applyPlan(
    request: billingGrpc.ApplyPlanRequest,
    context: RequestContext,
  ): Promise<billingGrpc.ApplyPlanResponse> {
    const actor = requireAccountContext(context);
    const { planId } = parseRpcRequest(planIdField, request);
    const dryRun = request.dryRun;
    const plan = await this.livePlan(this.prisma, planId);
    const accounts = await this.prisma.billingAccount.findMany({
      where: { planId: plan.id },
      orderBy: { id: 'asc' },
      select: BILLING_ACCOUNT_SELECT,
    });
    const now = new Date();
    const results: billingGrpc.ApplyAccount[] = [];
    let skippedPinned = 0;
    let unpublishSum: number | null = 0;
    for (const account of accounts) {
      if (account.entitlementsPinned) {
        skippedPinned++;
        continue;
      }
      const { next } = await this.entitlements.derive(this.prisma, account);
      const changed = !sameGrants(grantsOf(account), next);
      const wouldUnpublish = await this.wouldUnpublish(account.ownerUserId, next);
      unpublishSum =
        unpublishSum === null || wouldUnpublish === null ? null : unpublishSum + wouldUnpublish;
      let failed = false;
      if (!dryRun && changed) {
        failed = await this.applyOne(account.id, now, actor);
      }
      results.push({
        billingAccountId: account.id,
        ownerUserId: account.ownerUserId,
        changed,
        ...(wouldUnpublish === null ? {} : { wouldUnpublishPlaces: wouldUnpublish }),
        failed,
      });
    }
    const affected = results.filter((result) => result.changed && !result.failed).length;
    const failed = results.filter((result) => result.failed).length;
    if (!dryRun) {
      await this.prisma.$transaction((tx) =>
        this.audit(tx, actor, AuditAction.PLAN_APPLIED, plan.id, now, {
          after: { affected, skippedPinned, failed },
        }),
      );
    }
    return {
      dryRun,
      affected,
      skippedPinned,
      failed,
      ...(unpublishSum === null ? {} : { wouldUnpublishPlaces: unpublishSum }),
      // Boosts arrive with Phase 3.
      wouldEndBoosts: 0,
      accounts: results,
    };
  }

  /** Retires a plan nobody is on; `FREE` is never retired. */
  async retirePlan(
    request: billingGrpc.RetirePlanRequest,
    context: RequestContext,
  ): Promise<billingGrpc.RetirePlanResponse> {
    const actor = requireAccountContext(context);
    const { planId } = parseRpcRequest(planIdField, request);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const plan = await this.livePlan(tx, planId);
      if (plan.code === FREE_PLAN_CODE) throw rpcError('INVALID_STATE', { status: 'SYSTEM' });
      // Deactivated owners' accounts count too (api-endpoints-plan §6.1).
      const subscribers = await tx.billingAccount.count({ where: { planId: plan.id } });
      if (subscribers > 0) throw rpcError('PLAN_HAS_SUBSCRIBERS');
      await tx.plan.update({
        where: { id: plan.id },
        data: { deletedAt: now, deletedById: actor.userId, isActive: false },
        select: { id: true },
      });
      await this.audit(tx, actor, AuditAction.PLAN_RETIRED, plan.id, now, {
        before: { code: plan.code },
      });
    });
    return {};
  }

  /** One account's apply, in its own transaction. Returns whether it failed. */
  private async applyOne(
    billingAccountId: string,
    now: Date,
    actor: AccountContext,
  ): Promise<boolean> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const account = await this.entitlements.lockAccount(tx, { id: billingAccountId });
        if (account === null) return;
        await this.entitlements.rederive(tx, account, now, {
          type: AuditActorType.USER,
          userId: actor.userId,
        });
      });
      return false;
    } catch (error) {
      this.logger.warn(
        { billingAccountId, err: error instanceof Error ? error.name : 'unknown' },
        'plan apply failed for an account',
      );
      return true;
    }
  }

  /** Venues a new `max_places` would unpublish; null when catalog cannot count. */
  private async wouldUnpublish(ownerUserId: string, next: Entitlements): Promise<number | null> {
    const places = await this.catalog.countOwnerPlaces(ownerUserId);
    return places === null ? null : Math.max(0, places - next.maxPlaces);
  }

  private async livePlan(db: Prisma.TransactionClient, planId: string): Promise<AdminPlanRow> {
    const plan = await db.plan.findFirst({
      where: { id: planId, deletedAt: null },
      select: ADMIN_PLAN_SELECT,
    });
    if (plan === null) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'PLAN' });
    return plan;
  }

  private async subscriberCounts(planIds: readonly string[]): Promise<Map<string, number>> {
    const groups = await this.prisma.billingAccount.groupBy({
      by: ['planId'],
      where: { planId: { in: [...planIds] } },
      _count: { _all: true },
    });
    return new Map(groups.map((group) => [group.planId, group._count._all]));
  }

  private async audit(
    tx: Prisma.TransactionClient,
    actor: AccountContext,
    action: AuditAction,
    planId: string,
    now: Date,
    metadata: { before?: Record<string, unknown>; after?: Record<string, unknown> },
  ): Promise<void> {
    await this.outbox.add(
      tx,
      AUDIT_RECORD,
      billingAuditRecord({
        actor: { type: AuditActorType.USER, userId: actor.userId },
        action,
        resource: { type: AuditResourceType.PLAN, id: planId },
        metadata,
        origin: actor.origin,
        now,
      }),
    );
  }
}
