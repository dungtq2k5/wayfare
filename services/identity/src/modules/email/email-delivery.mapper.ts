import { EmailBounceType, EmailDeliveryStatus, EmailTemplate, parseEnum } from '@wayfare/contracts';
import {
  emailBounceTypeProto,
  emailDeliveryStatusProto,
  emailTemplateProto,
  identityGrpc,
} from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import type { Prisma } from '../../../generated/prisma/client';

/** A delivery row as support reads it: never a body, subject or link (rdm-spec I-13). */
export const EMAIL_DELIVERY_VIEW_SELECT = {
  id: true,
  template: true,
  toEmailMasked: true,
  status: true,
  bounceType: true,
  statusChangedAt: true,
  createdAt: true,
} as const satisfies Prisma.EmailDeliverySelect;

/** A delivery row as `EMAIL_DELIVERY_VIEW_SELECT` loads it. */
export type EmailDeliveryViewRow = Prisma.EmailDeliveryGetPayload<{
  select: typeof EMAIL_DELIVERY_VIEW_SELECT;
}>;

/** One send on the wire. */
export function toEmailDeliveryView(row: EmailDeliveryViewRow): identityGrpc.EmailDeliveryView {
  return {
    id: row.id,
    template: emailTemplateProto.toProto(parseEnum(EmailTemplate, row.template)),
    ...(row.toEmailMasked === null ? {} : { toEmailMasked: row.toEmailMasked }),
    status: emailDeliveryStatusProto.toProto(parseEnum(EmailDeliveryStatus, row.status)),
    bounceType:
      row.bounceType === null
        ? identityGrpc.EmailBounceType.EMAIL_BOUNCE_TYPE_UNSPECIFIED
        : emailBounceTypeProto.toProto(parseEnum(EmailBounceType, row.bounceType)),
    statusChangedAt: toProtoTimestamp(row.statusChangedAt),
    createdAt: toProtoTimestamp(row.createdAt),
  };
}
