import { z } from 'zod';
import { zUuidV7 } from '../common/ids';
import { zPageQuery } from '../common/pagination';
import { zBooleanParam } from '../common/params';
import { normalizeText } from '../common/text';
import { planWithinCeilings, zEntitlements } from '../entitlements/entitlements';
import { MAX_ADMIN_REASON_LENGTH } from '../identity/limits';
import { zMoney } from '../money/money';
import { BillingEventStatus, BillingInterval, StripeEndpoint, SubscriptionStatus } from './enums';
import { MAX_PLAN_CODE_LENGTH, MAX_PLAN_NAME_LENGTH, MAX_STRIPE_ID_LENGTH } from './limits';

const zInstant = z.iso.datetime({ offset: true });

/** A full grant set within every platform ceiling — what a plan or an override states. */
export const zGrantsInput = zEntitlements.refine(planWithinCeilings, {
  message: 'A grant exceeds its platform ceiling',
});

const zPlanName = z
  .string()
  .transform(normalizeText)
  .pipe(
    z
      .string()
      .min(1)
      .max(MAX_PLAN_NAME_LENGTH)
      .regex(/^[^\n]*$/),
  );

const zReason = z
  .string()
  .transform(normalizeText)
  .pipe(z.string().min(1).max(MAX_ADMIN_REASON_LENGTH));

/** A plan's code: upper snake case, as `FREE`, `GROWTH`, `PRO`. */
export const zPlanCode = z
  .string()
  .max(MAX_PLAN_CODE_LENGTH)
  .regex(/^[A-Z][A-Z0-9_]*$/, { message: 'Expected upper snake case' });

/** A Stripe Price id. */
export const zStripePriceId = z
  .string()
  .max(MAX_STRIPE_ID_LENGTH)
  .regex(/^price_[A-Za-z0-9]+$/, { message: 'Expected a Stripe Price id' });

/** One registered price of a plan (rdm-spec B-2). The amount is Stripe's, never typed. */
export const zPlanPrice = z
  .object({
    id: zUuidV7,
    stripePriceId: z.string(),
    billingInterval: z.enum(BillingInterval),
    amount: zMoney,
    isActive: z.boolean(),
    /** Registered. */
    createdAt: zInstant,
    /** Replaced by a later price of its interval; null while in force. */
    replacedAt: zInstant.nullable(),
  })
  .strict();
/** A registered price. */
export type PlanPrice = z.output<typeof zPlanPrice>;

/** A plan as an owner may buy it: its grants and its active prices (api-endpoints-plan §5.1). */
export const zPlan = z
  .object({
    id: zUuidV7,
    code: z.string(),
    name: z.string(),
    grants: zEntitlements,
    prices: z.array(zPlanPrice),
  })
  .strict();
/** A purchasable plan. */
export type Plan = z.output<typeof zPlan>;

/**
 * A plan's accounts (api-endpoints-plan §6.1): `total` is every account on it, deactivated owners
 * included — the number that decides retiring — and the rest count by state, which can overlap.
 */
export const zPlanSubscribers = z
  .object({
    total: z.number().int().min(0),
    /** `ACTIVE` or `TRIALING`. */
    active: z.number().int().min(0),
    pastDue: z.number().int().min(0),
    /** Cancelling at the period's end. */
    cancelling: z.number().int().min(0),
    pinned: z.number().int().min(0),
  })
  .strict();
/** A plan's subscribers. */
export type PlanSubscribers = z.output<typeof zPlanSubscribers>;

/** A plan as the admin catalogue shows it, with every price and its subscribers. */
export const zAdminPlan = z
  .object({
    id: zUuidV7,
    code: z.string(),
    name: z.string(),
    stripeProductId: z.string().nullable(),
    isActive: z.boolean(),
    sortOrder: z.number().int(),
    grants: zEntitlements,
    prices: z.array(zPlanPrice),
    /** Accounts whose effective plan this is (api-endpoints-plan §6.1). */
    subscribers: zPlanSubscribers,
    createdAt: zInstant,
    updatedAt: zInstant,
    /** Set once retired; only `includeRetired` lists a retired plan, and it has no page. */
    retiredAt: zInstant.nullable(),
  })
  .strict();
/** A catalogue plan. */
export type AdminPlan = z.output<typeof zAdminPlan>;

/** `POST /admin/plans` body: every grant required (rdm-spec B-1). */
export const zPlanInput = z
  .object({
    code: zPlanCode,
    name: zPlanName,
    sortOrder: z.number().int().min(0).max(32_767),
    isActive: z.boolean().optional(),
    grants: zGrantsInput,
  })
  .strict();
/** A validated new plan. */
export type PlanInput = z.output<typeof zPlanInput>;

/** `PATCH /admin/plans/:id` body: the catalogue row only; grants, when sent, are sent whole. */
export const zPlanUpdateInput = z
  .object({
    name: zPlanName.optional(),
    sortOrder: z.number().int().min(0).max(32_767).optional(),
    isActive: z.boolean().optional(),
    grants: zGrantsInput.optional(),
  })
  .strict();
/** A validated plan edit. */
export type PlanUpdateInput = z.output<typeof zPlanUpdateInput>;

/** `POST /admin/plans/:id/prices` body. */
export const zRegisterPriceInput = z
  .object({ stripePriceId: zStripePriceId, billingInterval: z.enum(BillingInterval) })
  .strict();

/** `GET /admin/plans` query. */
export const zAdminPlansQuery = z.object({ includeRetired: zBooleanParam }).strict();

/** `GET /admin/plans/:id/prices/lookup` query: the registration's body, as a query. */
export const zPriceLookupQuery = zRegisterPriceInput;

/** What registering a price would do (api-endpoints-plan §6.1): Stripe's answer, nothing written. */
export const zPriceLookup = z
  .object({
    amount: zMoney,
    interval: z.enum(BillingInterval),
    productId: z.string(),
    /** The interval's price in force it would replace. */
    replaces: zPlanPrice.nullable(),
  })
  .strict();
/** A price looked up. */
export type PriceLookup = z.output<typeof zPriceLookup>;

/** `POST /admin/plans/:id/apply` query. */
export const zApplyPlanQuery = z.object({ dryRun: zBooleanParam }).strict();

/** One account in an apply: what changes, or why it failed. */
export const zApplyAccount = z
  .object({
    billingAccountId: zUuidV7,
    ownerUserId: zUuidV7,
    changed: z.boolean(),
    /** Venues the new `max_places` would unpublish; null when catalog could not count. */
    wouldUnpublishPlaces: z.number().int().min(0).nullable(),
    failed: z.boolean(),
  })
  .strict();

/** `POST /admin/plans/:id/apply` result; a dry run has the same shape and wrote nothing. */
export const zApplyResult = z
  .object({
    dryRun: z.boolean(),
    affected: z.number().int().min(0),
    skippedPinned: z.number().int().min(0),
    failed: z.number().int().min(0),
    /** The sum over accounts; null when catalog could not count for some of them. */
    wouldUnpublishPlaces: z.number().int().min(0).nullable(),
    wouldEndBoosts: z.number().int().min(0),
    accounts: z.array(zApplyAccount),
  })
  .strict();
/** An apply's result. */
export type ApplyResult = z.output<typeof zApplyResult>;

/** `POST /owner/billing/checkout-session` body. */
export const zCheckoutInput = z.object({ planPriceId: zUuidV7 }).strict();

/** A Stripe-hosted page to send the owner to. */
export const zSessionUrl = z.object({ url: z.url() }).strict();

/** One invoice, as Stripe lists it (api-endpoints-plan §5.1). */
export const zInvoice = z
  .object({
    id: z.string(),
    number: z.string().nullable(),
    status: z.string(),
    total: zMoney,
    amountPaid: zMoney,
    createdAt: zInstant,
    hostedInvoiceUrl: z.string().nullable(),
    invoicePdfUrl: z.string().nullable(),
  })
  .strict();
/** An invoice. */
export type Invoice = z.output<typeof zInvoice>;

/** `GET /owner/billing` (api-endpoints-plan §5.1) — read from Postgres, never Stripe. */
export const zBillingOverview = z
  .object({
    plan: z.object({ id: zUuidV7, code: z.string(), name: z.string() }).strict(),
    price: zPlanPrice.nullable(),
    subscriptionStatus: z.enum(SubscriptionStatus),
    currentPeriodEnd: zInstant.nullable(),
    cancelAtPeriodEnd: z.boolean(),
    dunning: z.object({ since: zInstant }).strict().nullable(),
    entitlements: zEntitlements,
    usage: z
      .object({
        /** Null when catalog could not count. */
        places: z.number().int().min(0).nullable(),
        boostsLive: z.number().int().min(0),
      })
      .strict(),
    pinned: z.boolean(),
  })
  .strict();
/** The owner's billing page. */
export type BillingOverview = z.output<typeof zBillingOverview>;

/** The admin user read's `billing` (api-endpoints-plan §1.6): the owner's account, plan and status. */
export const zUserBilling = z
  .object({
    accountId: zUuidV7,
    planCode: z.string(),
    subscriptionStatus: z.enum(SubscriptionStatus),
  })
  .strict();
/** A user's billing row. */
export type UserBilling = z.output<typeof zUserBilling>;

/** `/users/me`'s `owner.billingSummary` (api-endpoints-plan §12.1). */
export const zBillingSummary = z
  .object({
    planCode: z.string(),
    subscriptionStatus: z.enum(SubscriptionStatus),
    dunningSince: zInstant.nullable(),
  })
  .strict();
/** The owner summary. */
export type BillingSummary = z.output<typeof zBillingSummary>;

/**
 * A billing account's owner, always shown on the billing pages (the account is theirs, not under
 * the names rule); both null for an erased account.
 */
export const zBillingOwner = z
  .object({ name: z.string().nullable(), email: z.string().nullable() })
  .strict();
/** A billing account's owner. */
export type BillingOwner = z.output<typeof zBillingOwner>;

/** One account in the admin list (api-endpoints-plan §6.2). */
export const zBillingAccountSummary = z
  .object({
    id: zUuidV7,
    ownerUserId: zUuidV7,
    owner: zBillingOwner,
    planCode: z.string(),
    subscriptionStatus: z.enum(SubscriptionStatus),
    pinned: z.boolean(),
    dunningSince: zInstant.nullable(),
    currentPeriodEnd: zInstant.nullable(),
    entitlementsVersion: z.number().int().min(0),
    createdAt: zInstant,
  })
  .strict();
/** An account row. */
export type BillingAccountSummary = z.output<typeof zBillingAccountSummary>;

/** One Stripe event as billing recorded it (rdm-spec B-4). */
export const zBillingEvent = z
  .object({
    id: zUuidV7,
    stripeEventId: z.string(),
    endpoint: z.enum(StripeEndpoint),
    livemode: z.boolean(),
    eventType: z.string(),
    stripeCreatedAt: zInstant,
    billingAccountId: zUuidV7.nullable(),
    status: z.enum(BillingEventStatus),
    errorLog: z.string().nullable(),
    receivedAt: zInstant,
    processedAt: zInstant.nullable(),
    /** The resolved account's owner; null while the event resolves to no account. */
    owner: zBillingOwner.nullable(),
    /**
     * The raw event, only in the single read (every event route requires `billing.event.read`);
     * null in a list.
     */
    payload: z.record(z.string(), z.unknown()).nullable(),
  })
  .strict();
/** A recorded event. */
export type BillingEvent = z.output<typeof zBillingEvent>;

/**
 * One account's detail (api-endpoints-plan §6.2): its subscription, effective grants beside its
 * plan's own, and its recent events. Boosts and the payout account are empty until Phase 3.
 */
export const zBillingAccountDetail = zBillingAccountSummary
  .extend({
    stripeCustomerId: z.string().nullable(),
    stripeSubscriptionId: z.string().nullable(),
    /** The plan being paid for, when there is a subscribed price. */
    subscribedPlanCode: z.string().nullable(),
    /** That price, as of the subscription's last event; kept after a cancellation. */
    subscribedPrice: z
      .object({ amount: zMoney, billingInterval: z.enum(BillingInterval) })
      .strict()
      .nullable(),
    cancelAtPeriodEnd: z.boolean(),
    entitlements: zEntitlements,
    planGrants: zEntitlements,
    boosts: z.array(z.never()),
    payoutAccount: z.null(),
    recentEvents: z.array(zBillingEvent),
  })
  .strict();
/** An account's detail. */
export type BillingAccountDetail = z.output<typeof zBillingAccountDetail>;

/** `GET /admin/billing/accounts` query. */
export const zBillingAccountsQuery = zPageQuery({
  sort: ['createdAt'],
  defaultSort: '-createdAt',
})
  .extend({
    planCode: zPlanCode.optional(),
    status: z.enum(SubscriptionStatus).optional(),
    pinned: zBooleanParam,
    dunning: zBooleanParam,
  })
  .strict();

/** `GET /admin/billing/events` query. */
export const zBillingEventsQuery = zPageQuery({
  sort: ['receivedAt'],
  defaultSort: '-receivedAt',
})
  .extend({
    status: z.enum(BillingEventStatus).optional(),
    eventType: z
      .string()
      .max(100)
      .regex(/^[a-z0-9_.]+$/)
      .optional(),
    billingAccountId: zUuidV7.optional(),
  })
  .strict();

/** `PATCH /admin/billing/accounts/:id/entitlements` body: the whole grant set and why. */
export const zEntitlementOverrideInput = z
  .object({ grants: zGrantsInput, reason: zReason })
  .strict();

/** `POST /admin/billing/accounts/:id/unpin` body. */
export const zUnpinInput = z.object({ reason: zReason }).strict();

/** `GET /admin/billing/accounts/:id/unpin-preview`: what unpinning would do, nothing written. */
export const zUnpinPreview = z
  .object({
    /** The grants the account returns to by today's plan and status. */
    grants: zEntitlements,
    /** The Places they would take off the map; null when catalog could not count. */
    wouldUnpublishPlaces: z.number().int().min(0).nullable(),
  })
  .strict();
/** An unpin's preview. */
export type UnpinPreview = z.output<typeof zUnpinPreview>;
