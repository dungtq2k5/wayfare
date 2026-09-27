import { Injectable } from '@nestjs/common';
import {
  AUDIT_RECORD,
  AuditAction,
  AuditResourceType,
  BILLING_ENTITLEMENTS_CHANGED,
  FREE_PLAN_CODE,
  grantsFor,
  parseEnum,
  SubscriptionStatus,
  subscribedPlanApplies,
  zUuidV7,
} from '@wayfare/contracts';
import type { Entitlements } from '@wayfare/contracts';
import type { billingGrpc } from '@wayfare/contracts/grpc';
import { OutboxService, parseRpcRequest, rpcError } from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { billingAuditRecord, NO_ORIGIN } from './domain/billing-audit';
import type { BillingAuditActor } from './domain/billing-audit';
import { grantColumns, grantsOf, plannedGrantsWrite } from './domain/grants-write';
import type { GrantsWrite } from './domain/grants-write';
import {
  BILLING_ACCOUNT_SELECT,
  PLAN_WITH_GRANTS_SELECT,
  toEntitlements,
} from './entitlement.mapper';
import type { BillingAccountRow, PlanWithGrantsRow } from './entitlement.mapper';

const ownerField = z.object({ ownerUserId: zUuidV7 });

/** How an account is looked up for a write. */
export type AccountKey = { readonly id: string } | { readonly ownerUserId: string };

/**
 * An owner's effective grants (rdm-spec B-3) — the RPC every limit check asks, and the one place a
 * grant column is written: `grantsFor` for a derived set, an override for a pinned one. A change
 * bumps `entitlements_version` and writes `billing.entitlements.changed` in the caller's
 * transaction; an unchanged recompute writes nothing.
 */
@Injectable()
export class EntitlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /** `{ entitlementsVersion, entitlements }`; no account → `RESOURCE_NOT_FOUND`, a denial. */
  async getEntitlements(
    request: billingGrpc.GetEntitlementsRequest,
    _context: RequestContext,
  ): Promise<billingGrpc.GetEntitlementsResponse> {
    const { ownerUserId } = parseRpcRequest(ownerField, request);
    const account = await this.prisma.billingAccount.findUnique({
      where: { ownerUserId },
      select: BILLING_ACCOUNT_SELECT,
    });
    if (account === null) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'BILLING_ACCOUNT' });
    return {
      entitlementsVersion: String(account.entitlementsVersion),
      entitlements: toEntitlements(grantsOf(account)),
    };
  }

  /** The account, locked for this transaction; null when there is none. */
  async lockAccount(
    tx: Prisma.TransactionClient,
    key: AccountKey,
  ): Promise<BillingAccountRow | null> {
    const locked =
      'id' in key
        ? await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM billing_accounts WHERE id = ${key.id}::uuid FOR UPDATE`
        : await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM billing_accounts WHERE owner_user_id = ${key.ownerUserId}::uuid FOR UPDATE`;
    const id = locked[0]?.id;
    if (id === undefined) return null;
    return tx.billingAccount.findUniqueOrThrow({ where: { id }, select: BILLING_ACCOUNT_SELECT });
  }

  /** The live `FREE` row — the source of Free's grants (rdm-spec B-1). Seeded in every environment. */
  async freePlan(db: Prisma.TransactionClient): Promise<PlanWithGrantsRow> {
    const plan = await db.plan.findFirst({
      where: { code: FREE_PLAN_CODE, deletedAt: null },
      select: PLAN_WITH_GRANTS_SELECT,
    });
    if (plan === null) throw new Error('The FREE plan is missing — run db:seed:system');
    return plan;
  }

  /**
   * Opens an owner's account on `FREE`, version 1, and publishes its first grants; a second call
   * for the same owner writes nothing (rdm-spec B-3). Returns whether it opened one.
   */
  async openFreeAccount(
    tx: Prisma.TransactionClient,
    ownerUserId: string,
    now: Date,
  ): Promise<boolean> {
    const free = await this.freePlan(tx);
    const grants = grantsFor(null, grantsOf(free), SubscriptionStatus.NONE);
    const { count } = await tx.billingAccount.createMany({
      data: [
        {
          ownerUserId,
          planId: free.id,
          subscriptionStatus: SubscriptionStatus.NONE,
          ...grantColumns(grants),
          entitlementsVersion: 1n,
        },
      ],
      skipDuplicates: true,
    });
    if (count === 0) return false;
    await this.outbox.add(tx, BILLING_ENTITLEMENTS_CHANGED, {
      occurredAt: now.toISOString(),
      ownerUserId,
      entitlementsVersion: 1,
      entitlements: grants,
      previous: null,
    });
    return true;
  }

  /**
   * Writes a grant set onto a locked account: the version bump and `billing.entitlements.changed`
   * when it differs, nothing when it does not. `pin` sets or clears the pin in the same write.
   */
  async writeGrants(
    tx: Prisma.TransactionClient,
    account: BillingAccountRow,
    next: Entitlements,
    now: Date,
    options: { readonly pin?: boolean } = {},
  ): Promise<GrantsWrite> {
    const current = grantsOf(account);
    const planned = plannedGrantsWrite(current, Number(account.entitlementsVersion), next);
    const pin = options.pin === undefined ? {} : { entitlementsPinned: options.pin };
    if (planned.changed) {
      await tx.billingAccount.update({
        where: { id: account.id },
        data: { ...grantColumns(next), entitlementsVersion: BigInt(planned.version), ...pin },
        select: { id: true },
      });
      await this.outbox.add(tx, BILLING_ENTITLEMENTS_CHANGED, {
        occurredAt: now.toISOString(),
        ownerUserId: account.ownerUserId,
        entitlementsVersion: planned.version,
        entitlements: next,
        previous: current,
      });
    } else if (options.pin !== undefined && options.pin !== account.entitlementsPinned) {
      await tx.billingAccount.update({
        where: { id: account.id },
        data: pin,
        select: { id: true },
      });
    }
    return planned;
  }

  /**
   * What an account's plan and status give it (rdm-spec B-3, `grantsFor`): the effective plan —
   * the subscribed one while its status applies, else `FREE` — and the grants that follow. Writes
   * nothing: the dry run reads this, and `rederive` writes it.
   */
  async derive(
    db: Prisma.TransactionClient,
    account: BillingAccountRow,
  ): Promise<{ readonly effectivePlanId: string; readonly next: Entitlements }> {
    const free = await this.freePlan(db);
    const subscribed =
      account.planPriceId === null
        ? null
        : await db.planPrice.findUnique({
            where: { id: account.planPriceId },
            select: { plan: { select: PLAN_WITH_GRANTS_SELECT } },
          });
    const status = parseEnum(SubscriptionStatus, account.subscriptionStatus);
    const subscribedPlan = subscribed?.plan ?? null;
    return {
      effectivePlanId:
        subscribedPlan !== null && subscribedPlanApplies(status) ? subscribedPlan.id : free.id,
      next: grantsFor(
        subscribedPlan === null ? null : grantsOf(subscribedPlan),
        grantsOf(free),
        status,
      ),
    };
  }

  /**
   * Re-derives a locked account: sets `plan_id` to the effective plan and, unless pinned, writes
   * the grants, with a `BILLING_ENTITLEMENTS_APPLIED` audit row when they changed. Returns the
   * grant write, or null for a pinned account.
   */
  async rederive(
    tx: Prisma.TransactionClient,
    account: BillingAccountRow,
    now: Date,
    actor: BillingAuditActor,
  ): Promise<GrantsWrite | null> {
    const { effectivePlanId, next } = await this.derive(tx, account);
    if (effectivePlanId !== account.planId) {
      await tx.billingAccount.update({
        where: { id: account.id },
        data: { planId: effectivePlanId },
        select: { id: true },
      });
    }
    if (account.entitlementsPinned) return null;
    const written = await this.writeGrants(tx, account, next, now);
    if (written.changed) {
      await this.outbox.add(
        tx,
        AUDIT_RECORD,
        billingAuditRecord({
          actor,
          action: AuditAction.BILLING_ENTITLEMENTS_APPLIED,
          resource: { type: AuditResourceType.BILLING_ACCOUNT, id: account.id },
          metadata: { after: { entitlementsVersion: written.version } },
          origin: NO_ORIGIN,
          now,
        }),
      );
    }
    return written;
  }
}
