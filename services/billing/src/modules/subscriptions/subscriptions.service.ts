import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  FREE_PLAN_CODE,
  INVOICE_CACHE_TTL_MS,
  parseEnum,
  SubscriptionStatus,
  zUuidV7,
} from '@wayfare/contracts';
import { subscriptionStatusProto } from '@wayfare/contracts/grpc';
import type { billingGrpc } from '@wayfare/contracts/grpc';
import {
  OutboxService,
  parseRpcRequest,
  requireAccountContext,
  rpcError,
  toProtoTimestamp,
} from '@wayfare/nest-common';
import type { AccountContext, RequestContext } from '@wayfare/nest-common';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import type { Env } from '../../config/env.schema';
import {
  PaymentsProvider,
  PaymentsUnavailableError,
} from '../../providers/payments/payments-provider';
import type { ProviderInvoice } from '../../providers/payments/payments-provider';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import { billingAuditRecord } from '../entitlements/domain/billing-audit';
import { grantsOf } from '../entitlements/domain/grants-write';
import { BILLING_ACCOUNT_SELECT, toEntitlements } from '../entitlements/entitlement.mapper';
import type { BillingAccountRow } from '../entitlements/entitlement.mapper';
import { ADMIN_PLAN_SELECT, PLAN_PRICE_SELECT, toPlan, toPlanPrice } from '../plans/plan.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';

const checkoutFields = z.object({ planPriceId: zUuidV7, idempotencyKey: zUuidV7 });
const ownerField = z.object({ ownerUserId: zUuidV7 });

/** The statuses under which an owner already has a subscription: plan changes go through the portal. */
const LIVE_SUBSCRIPTION: ReadonlySet<string> = new Set([
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.PAST_DUE,
]);

/** The console page Checkout and the portal come back to (api-endpoints-plan §5.1). */
const BILLING_PAGE = '/owner/billing';

/**
 * The calling owner's subscription (api-endpoints-plan §5.1). Every read is Postgres except the
 * invoice list, the one live Stripe read, cached. Entitlements are never written here: the webhook
 * writes them.
 */
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);
  private readonly consoleUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly payments: PaymentsProvider,
    private readonly catalog: CatalogServiceGrpcClient,
    @Inject(REDIS) private readonly redis: Pick<Redis, 'get' | 'set'>,
    config: ConfigService<Env, true>,
  ) {
    this.consoleUrl = config.get('CONSOLE_URL', { infer: true });
  }

  /** `GET /owner/billing` — Postgres only, and catalog's count of the owner's Venues. */
  async getOverview(context: RequestContext): Promise<billingGrpc.GetOverviewResponse> {
    const account = await this.accountOf(requireAccountContext(context));
    const [price, places] = await Promise.all([
      account.planPriceId === null
        ? null
        : this.prisma.planPrice.findUnique({
            where: { id: account.planPriceId },
            select: PLAN_PRICE_SELECT,
          }),
      this.catalog.countOwnerPlaces(account.ownerUserId),
    ]);
    return {
      plan: account.plan,
      price: price === null ? undefined : toPlanPrice(price),
      subscriptionStatus: subscriptionStatusProto.toProto(
        parseEnum(SubscriptionStatus, account.subscriptionStatus),
      ),
      currentPeriodEnd:
        account.currentPeriodEnd === null ? undefined : toProtoTimestamp(account.currentPeriodEnd),
      cancelAtPeriodEnd: account.cancelAtPeriodEnd,
      dunningSince:
        account.dunningStartedAt === null ? undefined : toProtoTimestamp(account.dunningStartedAt),
      entitlements: toEntitlements(grantsOf(account)),
      ...(places === null ? {} : { usagePlaces: places }),
      // Boosts arrive with Phase 3.
      usageBoostsLive: 0,
      pinned: account.entitlementsPinned,
    };
  }

  /** Plans an owner can move to: active, with an active price, never `FREE` (assigned, not sold). */
  async listPurchasablePlans(
    context: RequestContext,
  ): Promise<billingGrpc.ListPurchasablePlansResponse> {
    requireAccountContext(context);
    const rows = await this.prisma.plan.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        code: { not: FREE_PLAN_CODE },
        prices: { some: { isActive: true } },
      },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      select: ADMIN_PLAN_SELECT,
    });
    return { plans: rows.map(toPlan) };
  }

  /**
   * A Checkout Session for a subscription. The Customer is created outside any transaction —
   * idempotent by the account id, so two concurrent checkouts share one — then stored.
   */
  async createCheckoutSession(
    request: billingGrpc.CreateCheckoutSessionRequest,
    context: RequestContext,
  ): Promise<billingGrpc.CreateCheckoutSessionResponse> {
    const caller = requireAccountContext(context);
    const fields = parseRpcRequest(checkoutFields, request);
    const account = await this.accountOf(caller);
    const price = await this.prisma.planPrice.findUnique({
      where: { id: fields.planPriceId },
      select: {
        id: true,
        stripePriceId: true,
        isActive: true,
        plan: { select: { deletedAt: true } },
      },
    });
    if (price === null || !price.isActive || price.plan.deletedAt !== null) {
      throw rpcError('RESOURCE_NOT_FOUND', { resource: 'PLAN_PRICE' });
    }
    if (LIVE_SUBSCRIPTION.has(account.subscriptionStatus)) throw rpcError('SUBSCRIPTION_EXISTS');
    const customerId = await this.customerOf(account);
    const { url } = await this.stripe(() =>
      this.payments.createSubscriptionCheckout({
        customerId,
        priceId: price.stripePriceId,
        billingAccountId: account.id,
        successUrl: `${this.consoleUrl}${BILLING_PAGE}?checkout=success`,
        cancelUrl: `${this.consoleUrl}${BILLING_PAGE}?checkout=cancelled`,
        idempotencyKey: fields.idempotencyKey,
      }),
    );
    await this.audit(caller, AuditAction.BILLING_CHECKOUT_STARTED, account.id, {
      after: { planPriceId: price.id },
    });
    return { url };
  }

  /** The Customer Portal. An owner who never checked out has no customer: `NO_STRIPE_CUSTOMER`. */
  async createPortalSession(
    context: RequestContext,
  ): Promise<billingGrpc.CreatePortalSessionResponse> {
    const caller = requireAccountContext(context);
    const account = await this.accountOf(caller);
    if (account.stripeCustomerId === null) throw rpcError('NO_STRIPE_CUSTOMER');
    const customerId = account.stripeCustomerId;
    const { url } = await this.stripe(() =>
      this.payments.createPortalSession({
        customerId,
        returnUrl: `${this.consoleUrl}${BILLING_PAGE}`,
      }),
    );
    await this.audit(caller, AuditAction.BILLING_PORTAL_OPENED, account.id);
    return { url };
  }

  /** Stripe's invoices, cached per customer; no customer → none. */
  async listInvoices(context: RequestContext): Promise<billingGrpc.ListInvoicesResponse> {
    const account = await this.accountOf(requireAccountContext(context));
    if (account.stripeCustomerId === null) return { invoices: [] };
    const customerId = account.stripeCustomerId;
    const key = `billing:invoices:${customerId}`;
    const cached = await this.redis.get(key).catch(() => null);
    const invoices =
      cached === null
        ? await this.stripe(() => this.payments.listInvoices(customerId))
        : (JSON.parse(cached) as ProviderInvoice[]);
    if (cached === null) {
      await this.redis
        .set(key, JSON.stringify(invoices), 'PX', INVOICE_CACHE_TTL_MS)
        .catch(() => undefined);
    }
    return {
      invoices: invoices.map((invoice) => ({
        id: invoice.id,
        ...(invoice.number === null ? {} : { number: invoice.number }),
        status: invoice.status,
        totalMinor: invoice.total,
        amountPaidMinor: invoice.amountPaid,
        currency: invoice.currency.toUpperCase(),
        createdAt: toProtoTimestamp(new Date(invoice.created * 1000)),
        ...(invoice.hostedInvoiceUrl === null
          ? {}
          : { hostedInvoiceUrl: invoice.hostedInvoiceUrl }),
        ...(invoice.invoicePdf === null ? {} : { invoicePdfUrl: invoice.invoicePdf }),
      })),
    };
  }

  /** `/users/me`'s owner summary (api-endpoints-plan §12.1). */
  async getBillingSummary(
    request: billingGrpc.GetBillingSummaryRequest,
  ): Promise<billingGrpc.GetBillingSummaryResponse> {
    const { ownerUserId } = parseRpcRequest(ownerField, request);
    const account = await this.prisma.billingAccount.findUnique({
      where: { ownerUserId },
      select: BILLING_ACCOUNT_SELECT,
    });
    if (account === null) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'BILLING_ACCOUNT' });
    return {
      planCode: account.plan.code,
      subscriptionStatus: subscriptionStatusProto.toProto(
        parseEnum(SubscriptionStatus, account.subscriptionStatus),
      ),
      dunningSince:
        account.dunningStartedAt === null ? undefined : toProtoTimestamp(account.dunningStartedAt),
    };
  }

  /** The caller's account; an owner whose account is not open yet is `RESOURCE_NOT_FOUND`. */
  private async accountOf(caller: AccountContext): Promise<BillingAccountRow> {
    const account = await this.prisma.billingAccount.findUnique({
      where: { ownerUserId: caller.userId },
      select: BILLING_ACCOUNT_SELECT,
    });
    if (account === null) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'BILLING_ACCOUNT' });
    return account;
  }

  /** The account's Stripe Customer, created and stored on the first checkout. */
  private async customerOf(account: BillingAccountRow): Promise<string> {
    if (account.stripeCustomerId !== null) return account.stripeCustomerId;
    const { customerId } = await this.stripe(() =>
      this.payments.createCustomer({
        billingAccountId: account.id,
        ownerUserId: account.ownerUserId,
      }),
    );
    // Two checkouts racing get the same customer from Stripe's idempotency key; either store is fine.
    await this.prisma.billingAccount.updateMany({
      where: { id: account.id, stripeCustomerId: null },
      data: { stripeCustomerId: customerId },
    });
    return customerId;
  }

  /** A Stripe call: unavailable, or no key configured, is `503 UPSTREAM_UNAVAILABLE`. */
  private async stripe<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof PaymentsUnavailableError) {
        this.logger.warn({ reason: error.reason }, 'Stripe unavailable');
        throw rpcError('UPSTREAM_UNAVAILABLE');
      }
      throw error;
    }
  }

  private async audit(
    caller: AccountContext,
    action: AuditAction,
    billingAccountId: string,
    metadata?: { after: Record<string, unknown> },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.outbox.add(
        tx,
        AUDIT_RECORD,
        billingAuditRecord({
          actor: { type: AuditActorType.USER, userId: caller.userId },
          action,
          resource: { type: AuditResourceType.BILLING_ACCOUNT, id: billingAccountId },
          ...(metadata === undefined ? {} : { metadata }),
          origin: caller.origin,
          now: new Date(),
        }),
      );
    });
  }
}
