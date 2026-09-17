/** A plan price's interval — rdm-spec B-2 `billing_interval`. */
export enum BillingInterval {
  MONTH = 'MONTH',
  YEAR = 'YEAR',
}

/** Every `BillingInterval` value. */
export const BILLING_INTERVALS = Object.values(BillingInterval);

/** An owner's Stripe subscription state — rdm-spec B-3 `subscription_status`. */
export enum SubscriptionStatus {
  NONE = 'NONE',
  INCOMPLETE = 'INCOMPLETE',
  INCOMPLETE_EXPIRED = 'INCOMPLETE_EXPIRED',
  TRIALING = 'TRIALING',
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  UNPAID = 'UNPAID',
  CANCELED = 'CANCELED',
  PAUSED = 'PAUSED',
}

/** Every `SubscriptionStatus` value. */
export const SUBSCRIPTION_STATUSES = Object.values(SubscriptionStatus);

/** Which Stripe webhook endpoint delivered an event — rdm-spec B-4 `endpoint`. */
export enum StripeEndpoint {
  PLATFORM = 'PLATFORM',
  CONNECT = 'CONNECT',
}

/** Every `StripeEndpoint` value. */
export const STRIPE_ENDPOINTS = Object.values(StripeEndpoint);

/** What happened to a Stripe webhook event — rdm-spec B-4 `status`. */
export enum BillingEventStatus {
  RECEIVED = 'RECEIVED',
  PROCESSED = 'PROCESSED',
  SKIPPED_STALE = 'SKIPPED_STALE',
  SKIPPED_DUPLICATE = 'SKIPPED_DUPLICATE',
  IGNORED = 'IGNORED',
  FAILED = 'FAILED',
}

/** Every `BillingEventStatus` value. */
export const BILLING_EVENT_STATUSES = Object.values(BillingEventStatus);

/** Why a discovery boost ended — rdm-spec B-5 `ended_reason`. */
export enum BoostEndedReason {
  OWNER = 'OWNER',
  ENTITLEMENT_LIMIT = 'ENTITLEMENT_LIMIT',
  PLACE_UNAVAILABLE = 'PLACE_UNAVAILABLE',
}

/** Every `BoostEndedReason` value. */
export const BOOST_ENDED_REASONS = Object.values(BoostEndedReason);

/** A connected account's transfers capability — rdm-spec B-6 `transfers_status`. */
export enum TransfersStatus {
  ACTIVE = 'ACTIVE',
  PENDING = 'PENDING',
  RESTRICTED = 'RESTRICTED',
  UNSUPPORTED = 'UNSUPPORTED',
}

/** Every `TransfersStatus` value. */
export const TRANSFERS_STATUSES = Object.values(TransfersStatus);

/** A voucher offer's lifecycle — rdm-spec B-7 `status`. */
export enum VoucherOfferStatus {
  DRAFT = 'DRAFT',
  PENDING_REVIEW = 'PENDING_REVIEW',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  REJECTED = 'REJECTED',
  ARCHIVED = 'ARCHIVED',
}

/** Every `VoucherOfferStatus` value. */
export const VOUCHER_OFFER_STATUSES = Object.values(VoucherOfferStatus);

/** An order's state — rdm-spec B-9 `status`. */
export enum OrderStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
  REFUNDED = 'REFUNDED',
  DISPUTED = 'DISPUTED',
}

/** Every `OrderStatus` value. */
export const ORDER_STATUSES = Object.values(OrderStatus);

/** A voucher's state — rdm-spec B-10 `status`. */
export enum VoucherStatus {
  PENDING = 'PENDING',
  ISSUED = 'ISSUED',
  REDEEMED = 'REDEEMED',
  EXPIRED = 'EXPIRED',
  VOID = 'VOID',
}

/** Every `VoucherStatus` value. */
export const VOUCHER_STATUSES = Object.values(VoucherStatus);

/** Why a voucher was voided — rdm-spec B-10 `void_reason`. */
export enum VoucherVoidReason {
  REFUND = 'REFUND',
  DISPUTE = 'DISPUTE',
  ADMIN = 'ADMIN',
  PAYMENT_NOT_COMPLETED = 'PAYMENT_NOT_COMPLETED',
}

/** Every `VoucherVoidReason` value. */
export const VOUCHER_VOID_REASONS = Object.values(VoucherVoidReason);

/** Why a refund was made — rdm-spec B-11 `reason`. */
export enum RefundReason {
  REQUESTED_BY_CUSTOMER = 'REQUESTED_BY_CUSTOMER',
  DUPLICATE = 'DUPLICATE',
  FRAUDULENT = 'FRAUDULENT',
  VENUE_UNAVAILABLE = 'VENUE_UNAVAILABLE',
  ADMIN = 'ADMIN',
}

/** Every `RefundReason` value. */
export const REFUND_REASONS = Object.values(RefundReason);

/** A refund's state — rdm-spec B-11 `status`. */
export enum RefundStatus {
  PENDING = 'PENDING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  CANCELED = 'CANCELED',
}

/** Every `RefundStatus` value. */
export const REFUND_STATUSES = Object.values(RefundStatus);

/** A dispute's state — rdm-spec B-12 `status`. */
export enum DisputeStatus {
  WARNING_NEEDS_RESPONSE = 'WARNING_NEEDS_RESPONSE',
  WARNING_UNDER_REVIEW = 'WARNING_UNDER_REVIEW',
  WARNING_CLOSED = 'WARNING_CLOSED',
  NEEDS_RESPONSE = 'NEEDS_RESPONSE',
  UNDER_REVIEW = 'UNDER_REVIEW',
  WON = 'WON',
  LOST = 'LOST',
}

/** Every `DisputeStatus` value. */
export const DISPUTE_STATUSES = Object.values(DisputeStatus);

/** A staff membership's state — rdm-spec B-13 `status`. */
export enum StaffMembershipStatus {
  INVITED = 'INVITED',
  ACTIVE = 'ACTIVE',
  REVOKED = 'REVOKED',
  EXPIRED = 'EXPIRED',
}

/** Every `StaffMembershipStatus` value. */
export const STAFF_MEMBERSHIP_STATUSES = Object.values(StaffMembershipStatus);
