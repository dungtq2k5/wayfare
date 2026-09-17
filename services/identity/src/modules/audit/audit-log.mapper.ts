import type { identityGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import type { Prisma } from '../../../generated/prisma/client';

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

/** An audit row as `AUDIT_LOG_VIEW_SELECT` loads it. */
export type AuditLogViewRow = Prisma.AuditLogGetPayload<{ select: typeof AUDIT_LOG_VIEW_SELECT }>;

/**
 * One audit row on the wire. `action` and the two types stay strings (conventions §6.3);
 * `metadata` is returned as stored — allowlisted by construction.
 */
export function toAuditLogEntry(row: AuditLogViewRow): identityGrpc.AuditLogEntry {
  return {
    id: row.id,
    occurredAt: toProtoTimestamp(row.occurredAt),
    service: row.service,
    actor: {
      type: row.actorType,
      ...(row.actorUserId === null ? {} : { userId: row.actorUserId }),
      ...(row.actorDeviceId === null ? {} : { deviceId: row.actorDeviceId }),
    },
    action: row.action,
    resource: {
      type: row.resourceType,
      ...(row.resourceId === null ? {} : { id: row.resourceId }),
    },
    metadataJson: JSON.stringify(row.metadata),
    ...(row.ip === null ? {} : { ip: row.ip }),
    ...(row.userAgent === null ? {} : { userAgent: row.userAgent }),
  };
}
