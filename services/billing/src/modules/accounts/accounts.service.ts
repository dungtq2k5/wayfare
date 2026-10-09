import { Injectable } from '@nestjs/common';
import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  zBillingAccountsQuery,
  zEntitlementOverrideInput,
  zUnpinInput,
  zUuidV7,
} from '@wayfare/contracts';
import { subscriptionStatusProto } from '@wayfare/contracts/grpc';
import type { billingGrpc } from '@wayfare/contracts/grpc';
import {
  OutboxService,
  parseRpcRequest,
  requireAccountContext,
  rpcError,
} from '@wayfare/nest-common';
import type { AccountContext, RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client';
import { BILLING_EVENT_SELECT } from '../billing-events/billing-event.mapper';
import { billingAuditRecord } from '../entitlements/domain/billing-audit';
import { grantsOf } from '../entitlements/domain/grants-write';
import {
  BILLING_ACCOUNT_SELECT,
  fromProtoEntitlements,
  PLAN_WITH_GRANTS_SELECT,
} from '../entitlements/entitlement.mapper';
import type { BillingAccountRow } from '../entitlements/entitlement.mapper';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { PrismaService } from '../prisma/prisma.service';
import { toBillingAccountDetail, toBillingAccountSummary } from './account.mapper';

const accountIdField = z.object({ billingAccountId: zUuidV7 });

/** How many recent events the detail shows. */
const RECENT_EVENTS = 20;

/**
 * Billing accounts, as staff see and adjust them (api-endpoints-plan §6.2). An override writes the
 * grants directly and pins them in the same write, so the next renewal webhook cannot revert it;
 * unpinning re-derives from the plan now.
 */
@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** A page of accounts, newest first, filtered by plan, status, pin and dunning. */
  async listAccounts(
    request: billingGrpc.ListAccountsRequest,
    context: RequestContext,
  ): Promise<billingGrpc.ListAccountsResponse> {
    requireAccountContext(context);
    const query = parseRpcRequest(zBillingAccountsQuery.omit({ pinned: true, dunning: true }), {
      page: request.page?.page,
      pageSize: request.page?.pageSize,
      sort: request.page?.sort === '' ? undefined : request.page?.sort,
      planCode: request.planCode ?? undefined,
      status: subscriptionStatusProto.fromProto(request.status) ?? undefined,
    });
    const where: Prisma.BillingAccountWhereInput = {
      ...(query.planCode === undefined ? {} : { plan: { code: query.planCode } }),
      ...(query.status === undefined ? {} : { subscriptionStatus: query.status }),
      ...(request.pinned === undefined || request.pinned === null
        ? {}
        : { entitlementsPinned: request.pinned }),
      ...(request.dunning === undefined || request.dunning === null
        ? {}
        : { dunningStartedAt: request.dunning ? { not: null } : null }),
    };
    const descending = query.sort.startsWith('-');
    const [total, rows] = await Promise.all([
      this.prisma.billingAccount.count({ where }),
      this.prisma.billingAccount.findMany({
        where,
        orderBy: [{ createdAt: descending ? 'desc' : 'asc' }, { id: descending ? 'desc' : 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: BILLING_ACCOUNT_SELECT,
      }),
    ]);
    return {
      accounts: rows.map(toBillingAccountSummary),
      page: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  /** One account: effective grants beside its plan's, the subscribed plan, recent events. */
  async getAccount(
    request: billingGrpc.GetAccountRequest,
    context: RequestContext,
  ): Promise<billingGrpc.GetAccountResponse> {
    requireAccountContext(context);
    const { billingAccountId } = parseRpcRequest(accountIdField, request);
    return { account: await this.detail(this.prisma, billingAccountId) };
  }

  /** An off-catalogue grant: the whole set, within ceilings, pinned in the same write. */
  async overrideEntitlements(
    request: billingGrpc.OverrideEntitlementsRequest,
    context: RequestContext,
  ): Promise<billingGrpc.OverrideEntitlementsResponse> {
    const actor = requireAccountContext(context);
    const { billingAccountId } = parseRpcRequest(accountIdField, request);
    const grants = request.grants ?? undefined;
    const input = parseRpcRequest(zEntitlementOverrideInput, {
      grants: grants === undefined ? undefined : fromProtoEntitlements(grants),
      reason: request.reason,
    });
    const now = new Date();
    const account = await this.prisma.$transaction(async (tx) => {
      const current = await this.locked(tx, billingAccountId);
      await this.entitlements.writeGrants(tx, current, input.grants, now, { pin: true });
      await this.audit(tx, actor, AuditAction.ENTITLEMENTS_OVERRIDDEN, current.id, now, {
        before: { grants: grantsOf(current) },
        after: { grants: input.grants },
        reason: input.reason,
      });
      return this.detail(tx, current.id);
    });
    return { account };
  }

  /** Clears the pin and re-derives the grants from the plan and status now. */
  async unpinEntitlements(
    request: billingGrpc.UnpinEntitlementsRequest,
    context: RequestContext,
  ): Promise<billingGrpc.UnpinEntitlementsResponse> {
    const actor = requireAccountContext(context);
    const { billingAccountId } = parseRpcRequest(accountIdField, request);
    const { reason } = parseRpcRequest(zUnpinInput, { reason: request.reason });
    const now = new Date();
    const account = await this.prisma.$transaction(async (tx) => {
      const current = await this.locked(tx, billingAccountId);
      await tx.billingAccount.update({
        where: { id: current.id },
        data: { entitlementsPinned: false },
        select: { id: true },
      });
      const unpinned = await this.locked(tx, current.id);
      await this.entitlements.rederive(tx, unpinned, now, {
        type: AuditActorType.USER,
        userId: actor.userId,
      });
      await this.audit(tx, actor, AuditAction.ENTITLEMENTS_UNPINNED, current.id, now, { reason });
      return this.detail(tx, current.id);
    });
    return { account };
  }

  private async locked(tx: Prisma.TransactionClient, id: string): Promise<BillingAccountRow> {
    const account = await this.entitlements.lockAccount(tx, { id });
    if (account === null) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'BILLING_ACCOUNT' });
    return account;
  }

  private async detail(
    db: Prisma.TransactionClient,
    billingAccountId: string,
  ): Promise<billingGrpc.BillingAccountDetail> {
    // The columns, then each relation, one after another: one `select` with all of them makes
    // Prisma send the relations at the same moment, and on a transaction (one connection) `pg`
    // warns that it is already busy.
    const where = { id: billingAccountId };
    const columns = await db.billingAccount.findUnique({ where, select: BILLING_ACCOUNT_SELECT });
    if (columns === null) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'BILLING_ACCOUNT' });
    const { plan } = await db.billingAccount.findUniqueOrThrow({
      where,
      select: { plan: { select: PLAN_WITH_GRANTS_SELECT } },
    });
    const { planPrice } = await db.billingAccount.findUniqueOrThrow({
      where,
      select: { planPrice: { select: { plan: { select: { code: true } } } } },
    });
    const { events } = await db.billingAccount.findUniqueOrThrow({
      where,
      select: {
        events: {
          orderBy: { stripeCreatedAt: 'desc' },
          take: RECENT_EVENTS,
          select: BILLING_EVENT_SELECT,
        },
      },
    });
    const row = { ...columns, plan, planPrice, events };
    return toBillingAccountDetail(
      row,
      grantsOf(row.plan),
      row.planPrice?.plan.code ?? null,
      row.events,
    );
  }

  private async audit(
    tx: Prisma.TransactionClient,
    actor: AccountContext,
    action: AuditAction,
    billingAccountId: string,
    now: Date,
    metadata: {
      before?: Record<string, unknown>;
      after?: Record<string, unknown>;
      reason?: string;
    },
  ): Promise<void> {
    await this.outbox.add(
      tx,
      AUDIT_RECORD,
      billingAuditRecord({
        actor: { type: AuditActorType.USER, userId: actor.userId },
        action,
        resource: { type: AuditResourceType.BILLING_ACCOUNT, id: billingAccountId },
        metadata,
        origin: actor.origin,
        now,
      }),
    );
  }
}
