import { BillingEventStatus, parseEnum, StripeEndpoint } from '@wayfare/contracts';
import { billingEventStatusProto, stripeEndpointProto } from '@wayfare/contracts/grpc';
import type { billingGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import type { Prisma } from '../../../generated/prisma/client';

/** A recorded event's columns (rdm-spec B-4), without its payload: the lists' rows. */
export const BILLING_EVENT_SELECT = {
  id: true,
  stripeEventId: true,
  endpoint: true,
  livemode: true,
  eventType: true,
  stripeCreatedAt: true,
  billingAccountId: true,
  status: true,
  errorLog: true,
  receivedAt: true,
  processedAt: true,
} as const satisfies Prisma.BillingEventSelect;

/** An event with its resolved account's owner, as the events list loads it. */
export const BILLING_EVENT_WITH_OWNER_SELECT = {
  ...BILLING_EVENT_SELECT,
  billingAccount: { select: { ownerUserId: true } },
} as const satisfies Prisma.BillingEventSelect;

/** One event, its payload included: the single read's. */
export const BILLING_EVENT_FULL_SELECT = {
  ...BILLING_EVENT_WITH_OWNER_SELECT,
  payload: true,
} as const satisfies Prisma.BillingEventSelect;

/** An event as one of the selects loads it. */
export type BillingEventRow = Prisma.BillingEventGetPayload<{
  select: typeof BILLING_EVENT_SELECT;
}> & {
  readonly billingAccount?: { readonly ownerUserId: string } | null;
  readonly payload?: Prisma.JsonValue;
};

/**
 * An event on the wire, with its owner — from the row's account, or `ownerUserId` when the caller
 * already knows it — and its payload as JSON only when loaded (the single read). Every event route
 * needs `billing.event.read`: a payload may hold a customer's email.
 */
export function toBillingEvent(
  row: BillingEventRow,
  ownerUserId = row.billingAccount?.ownerUserId,
): billingGrpc.BillingEvent {
  return {
    id: row.id,
    stripeEventId: row.stripeEventId,
    endpoint: stripeEndpointProto.toProto(parseEnum(StripeEndpoint, row.endpoint)),
    livemode: row.livemode,
    eventType: row.eventType,
    stripeCreatedAt: toProtoTimestamp(row.stripeCreatedAt),
    ...(row.billingAccountId === null ? {} : { billingAccountId: row.billingAccountId }),
    status: billingEventStatusProto.toProto(parseEnum(BillingEventStatus, row.status)),
    ...(row.errorLog === null ? {} : { errorLog: row.errorLog }),
    receivedAt: toProtoTimestamp(row.receivedAt),
    processedAt: row.processedAt === null ? undefined : toProtoTimestamp(row.processedAt),
    payloadJson: row.payload === undefined ? '' : JSON.stringify(row.payload),
    ...(ownerUserId === undefined ? {} : { ownerUserId }),
  };
}
