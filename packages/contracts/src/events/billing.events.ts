import { z } from 'zod';
import { RefundReason } from '../billing/enums';
import { MAX_OFFER_TITLE_LENGTH, MAX_VOUCHERS_PER_ORDER } from '../billing/limits';
import { DISCOVERY_BOOST_MAX, DISCOVERY_BOOST_MIN } from '../catalog/limits';
import { zUuidV7 } from '../common/ids';
import { zEntitlements } from '../entitlements/entitlements';
import { zMoney } from '../money/money';
import { zDecisionNote } from '../notifications/data';
import { MAX_SELLER_NAME_LENGTH, zReviewDecision } from '../notifications/email-templates';
import { defineEvent, eventSchema, zEventInstant } from './event-definition';

/** `billing.entitlements.changed` — an owner's effective grants changed; `previous` is null the first time. */
export const BILLING_ENTITLEMENTS_CHANGED = defineEvent({
  subject: 'billing.entitlements.changed',
  publisher: 'billing',
  stream: 'BILLING',
  schema: eventSchema({
    ownerUserId: zUuidV7,
    entitlementsVersion: z.number().int().min(1),
    entitlements: zEntitlements,
    previous: zEntitlements.nullable(),
  }),
  aggregateId: (payload) => payload.ownerUserId,
});

/** `billing.boosts.changed` — a Place's discovery boost weight changed. */
export const BILLING_BOOSTS_CHANGED = defineEvent({
  subject: 'billing.boosts.changed',
  publisher: 'billing',
  stream: 'BILLING',
  schema: eventSchema({
    placeId: zUuidV7,
    discoveryBoost: z.number().int().min(DISCOVERY_BOOST_MIN).max(DISCOVERY_BOOST_MAX),
  }),
  aggregateId: (payload) => payload.placeId,
});

/** `billing.subscription.payment_failed` — a renewal charge failed. */
export const BILLING_SUBSCRIPTION_PAYMENT_FAILED = defineEvent({
  subject: 'billing.subscription.payment_failed',
  publisher: 'billing',
  stream: 'BILLING',
  schema: eventSchema({
    ownerUserId: zUuidV7,
    attemptCount: z.number().int().min(1),
    nextAttemptAt: zEventInstant.optional(),
  }),
  aggregateId: (payload) => payload.ownerUserId,
});

/** `billing.order.paid` — a voucher order was paid. */
export const BILLING_ORDER_PAID = defineEvent({
  subject: 'billing.order.paid',
  publisher: 'billing',
  stream: 'BILLING',
  schema: eventSchema({
    orderId: zUuidV7,
    ownerUserId: zUuidV7,
    placeId: zUuidV7,
    quantity: z.number().int().min(1).max(MAX_VOUCHERS_PER_ORDER),
    amount: zMoney,
  }),
  aggregateId: (payload) => payload.orderId,
});

/** `billing.offer.reviewed` — a voucher offer was approved or rejected. */
export const BILLING_OFFER_REVIEWED = defineEvent({
  subject: 'billing.offer.reviewed',
  publisher: 'billing',
  stream: 'BILLING',
  schema: eventSchema({
    offerId: zUuidV7,
    ownerUserId: zUuidV7,
    decision: zReviewDecision,
    decisionNote: zDecisionNote.optional(),
  }),
  aggregateId: (payload) => payload.offerId,
});

/** `billing.payout_account.action_required` — Stripe needs more from the owner. */
export const BILLING_PAYOUT_ACCOUNT_ACTION_REQUIRED = defineEvent({
  subject: 'billing.payout_account.action_required',
  publisher: 'billing',
  stream: 'BILLING',
  schema: eventSchema({ ownerUserId: zUuidV7, requirementsDueCount: z.number().int().min(1) }),
  aggregateId: (payload) => payload.ownerUserId,
});

/**
 * `billing.voucher.refunded` — vouchers of one order were refunded. `buyerUserId` is null for a
 * buyer with no account, or an erased one (ADR 0048); identity then sends nothing.
 */
export const BILLING_VOUCHER_REFUNDED = defineEvent({
  subject: 'billing.voucher.refunded',
  publisher: 'billing',
  stream: 'BILLING',
  schema: eventSchema({
    orderId: zUuidV7,
    buyerUserId: zUuidV7.nullable(),
    voucherIds: z.array(zUuidV7).min(1).max(MAX_VOUCHERS_PER_ORDER),
    reason: z.enum(RefundReason),
  }),
  aggregateId: (payload) => payload.orderId,
});

/** `billing.voucher.moved` — a voucher was reissued to another device. */
export const BILLING_VOUCHER_MOVED = defineEvent({
  subject: 'billing.voucher.moved',
  publisher: 'billing',
  stream: 'BILLING',
  schema: eventSchema({
    voucherId: zUuidV7,
    buyerUserId: zUuidV7,
    offerTitle: z.string().min(1).max(MAX_OFFER_TITLE_LENGTH),
  }),
  aggregateId: (payload) => payload.voucherId,
});

/**
 * `billing.staff.invited` — a seller invited a staff member. The one payload carrying a secret and
 * an address: billing mints the token its own route accepts, and identity renders the link. It is
 * `sensitive`, so its outbox row is cleared on publish (conventions §9.1).
 */
export const BILLING_STAFF_INVITED = defineEvent({
  subject: 'billing.staff.invited',
  publisher: 'billing',
  stream: 'BILLING',
  sensitive: true,
  schema: eventSchema({
    membershipId: zUuidV7,
    billingAccountId: zUuidV7,
    invitedEmail: z.email().max(254),
    sellerName: z.string().min(1).max(MAX_SELLER_NAME_LENGTH),
    inviteToken: z.string().min(1).max(256),
    expiresAt: zEventInstant,
  }),
  aggregateId: (payload) => payload.membershipId,
});
