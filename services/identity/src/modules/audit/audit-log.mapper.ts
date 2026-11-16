import { AuditResourceType } from '@wayfare/contracts';
import { accountKindProto } from '@wayfare/contracts/grpc';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import type { Prisma } from '../../../generated/prisma/client';
import { kindOf } from '../admin-users/domain/account-kind';
import { nameOf } from '../users/domain/name-of';

/** An audit row as the console reads it (rdm-spec I-11). */
export const AUDIT_LOG_VIEW_SELECT = {
  id: true,
  occurredAt: true,
  service: true,
  actorType: true,
  actorUserId: true,
  actorDeviceId: true,
  action: true,
  resourceType: true,
  resourceId: true,
  metadata: true,
  ip: true,
  userAgent: true,
} as const satisfies Prisma.AuditLogSelect;

/** A person a page of rows names, as an actor or a resource. */
export const AUDIT_PERSON_SELECT = {
  id: true,
  fullName: true,
  email: true,
  erasedAt: true,
  roles: { select: { role: { select: { code: true } } } },
} as const satisfies Prisma.UserSelect;

/** A person as `AUDIT_PERSON_SELECT` loads them. */
export type AuditPersonRow = Prisma.UserGetPayload<{ select: typeof AUDIT_PERSON_SELECT }>;

/** An audit row as `AUDIT_LOG_VIEW_SELECT` loads it. */
export type AuditLogViewRow = Prisma.AuditLogGetPayload<{ select: typeof AUDIT_LOG_VIEW_SELECT }>;

/**
 * One audit row on the wire. `action` and the two types stay strings (conventions §6.3);
 * `metadata` is returned as stored — allowlisted by construction.
 */
export function toAuditLogEntry(
  row: AuditLogViewRow,
  people: ReadonlyMap<string, AuditPersonRow>,
): identityGrpc.AuditLogEntry {
  const actor = row.actorUserId === null ? undefined : people.get(row.actorUserId);
  const subject =
    row.resourceType === (AuditResourceType.USER as string) && row.resourceId !== null
      ? people.get(row.resourceId)
      : undefined;
  return {
    id: row.id,
    occurredAt: toProtoTimestamp(row.occurredAt),
    service: row.service,
    actor: {
      type: row.actorType,
      ...(row.actorUserId === null ? {} : { userId: row.actorUserId }),
      ...(row.actorDeviceId === null ? {} : { deviceId: row.actorDeviceId }),
      ...(actor === undefined
        ? {}
        : {
            ...nameOf(actor),
            kind: accountKindProto.toProto(kindOf(actor.roles.map(({ role }) => role.code))),
          }),
    },
    action: row.action,
    resource: {
      type: row.resourceType,
      ...(row.resourceId === null ? {} : { id: row.resourceId }),
      ...(subject === undefined || nameOf(subject).name === undefined
        ? {}
        : { label: nameOf(subject).name }),
    },
    metadataJson: JSON.stringify(row.metadata),
    ...(row.ip === null ? {} : { ip: row.ip }),
    ...(row.userAgent === null ? {} : { userAgent: row.userAgent }),
  };
}
