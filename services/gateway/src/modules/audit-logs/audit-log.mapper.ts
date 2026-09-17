import { AuditActorType, AuditResourceType, parseEnum } from '@wayfare/contracts';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import { fromProtoTimestamp, toProtoTimestamp } from '@wayfare/nest-common';
import type { AuditLogResponseDto } from './dto/audit-log-response.dto';
import type { ListAuditLogsQueryDto } from './dto/audit-log.dto';

/**
 * One audit row. The actor and resource types are checked against their enums on the way out —
 * a value this build does not know is a server fault; the action passes through as a string.
 */
export function toAuditLogResponseDto(entry: identityGrpc.AuditLogEntry): AuditLogResponseDto {
  const metadata: unknown = JSON.parse(entry.metadataJson);
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    throw new Error('An audit row carries non-object metadata');
  }
  return {
    id: entry.id,
    occurredAt: fromProtoTimestamp(entry.occurredAt, 'occurredAt').toISOString(),
    service: entry.service,
    actor: {
      type: parseEnum(AuditActorType, entry.actor?.type ?? ''),
      userId: entry.actor?.userId ?? null,
      deviceId: entry.actor?.deviceId ?? null,
    },
    action: entry.action,
    resource: {
      type: parseEnum(AuditResourceType, entry.resource?.type ?? ''),
      id: entry.resource?.id ?? null,
    },
    metadata: metadata as Record<string, unknown>,
    ip: entry.ip ?? null,
    userAgent: entry.userAgent ?? null,
  };
}

/** The `ListAuditLogs` request. */
export function toListAuditLogsRequest(
  query: ListAuditLogsQueryDto,
): identityGrpc.ListAuditLogsRequest {
  return {
    page: {
      limit: query.limit,
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    },
    from: toProtoTimestamp(new Date(query.from)),
    to: toProtoTimestamp(new Date(query.to)),
    ...(query.actorUserId === undefined ? {} : { actorUserId: query.actorUserId }),
    ...(query.action === undefined ? {} : { action: query.action }),
    ...(query.resourceType === undefined ? {} : { resourceType: query.resourceType }),
    ...(query.resourceId === undefined ? {} : { resourceId: query.resourceId }),
  };
}
