import { BillingEventStatus, parseEnum, StripeEndpoint } from '@wayfare/contracts';
import { billingEventStatusProto, stripeEndpointProto } from '@wayfare/contracts/grpc';
import type { billingGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import type { Prisma } from '../../../generated/prisma/client';

/** A recorded event's columns (rdm-spec B-4), the payload included. */
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
  payload: true,
} as const satisfies Prisma.BillingEventSelect;

/** An event as `BILLING_EVENT_SELECT` loads it. */
export type BillingEventRow = Prisma.BillingEventGetPayload<{
  select: typeof BILLING_EVENT_SELECT;
}>;

/** An event on the wire; its payload as JSON — every event route needs `billing.event.read`. */
export function toBillingEvent(row: BillingEventRow): billingGrpc.BillingEvent {
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
    payloadJson: JSON.stringify(row.payload),
  };
}
