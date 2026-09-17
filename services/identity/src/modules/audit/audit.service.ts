import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  AUDIT_QUERY_MAX_DAYS,
  compareStrings,
  zAuditActionFilter,
  zCursorQuery,
  zUuidV7,
} from '@wayfare/contracts';
import type { AuditRecordPayload } from '@wayfare/contracts';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import {
  decodeCursor,
  encodeCursor,
  isUniqueConstraintViolation,
  parseRpcRequest,
  requireAccountContext,
  rpcError,
  zProtoTimestamp,
} from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_LOG_VIEW_SELECT, toAuditLogEntry } from './audit-log.mapper';

const DAY_MS = 86_400_000;

const listFields = z
  .object({
    page: zCursorQuery,
    from: zProtoTimestamp,
    to: zProtoTimestamp,
    actorUserId: zUuidV7.optional(),
    action: zAuditActionFilter.optional(),
    resourceType: z
      .string()
      .max(32)
      .regex(/^[A-Z][A-Z0-9_]*$/)
      .optional(),
    resourceId: zUuidV7.optional(),
  })
  .refine((fields) => fields.to.getTime() > fields.from.getTime(), {
    path: ['to'],
    message: 'must be after from',
  })
  .refine(
    (fields) => fields.to.getTime() - fields.from.getTime() <= AUDIT_QUERY_MAX_DAYS * DAY_MS,
    {
      path: ['to'],
      message: `at most ${AUDIT_QUERY_MAX_DAYS} days after from`,
    },
  );

/** The build's action vocabulary, sorted once (api-endpoints-plan §1.8). */
const SORTED_ACTIONS = [...AUDIT_ACTIONS].toSorted(compareStrings);

/** Writes `audit.record` events into `audit_logs` and reads them for the console (rdm-spec I-11). */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Inserts one audit row keyed on the producer's `eventId`. A redelivery hits the unique index
   * and is treated as already applied — idempotent without a `processed_events` row.
   * @returns whether a row was written.
   */
  async record(payload: AuditRecordPayload): Promise<boolean> {
    try {
      await this.prisma.auditLog.create({
        data: {
          eventId: payload.eventId,
          occurredAt: new Date(payload.occurredAt),
          service: payload.service,
          actorType: payload.actor.type,
          actorUserId: payload.actor.userId ?? null,
          actorDeviceId: payload.actor.deviceId ?? null,
          action: payload.action,
          resourceType: payload.resource.type,
          resourceId: payload.resource.id ?? null,
          // Validated JSON from the allowlisted schema; zod's `unknown` values are JSON by construction.
          metadata: payload.metadata as Prisma.InputJsonObject,
          ip: payload.ip ?? null,
          userAgent: payload.userAgent ?? null,
        },
        select: { id: true },
      });
      return true;
    } catch (error) {
      if (isUniqueConstraintViolation(error)) return false; // already applied
      throw error; // transient: the runner naks and retries
    }
  }

  /**
   * One page of the audit log inside a bounded window, newest first by the producer's clock, then
   * id; the cursor carries both (api-endpoints-plan §1.8). Every filter shape has an index.
   */
  async listAuditLogs(
    request: identityGrpc.ListAuditLogsRequest,
    context: RequestContext,
  ): Promise<identityGrpc.ListAuditLogsResponse> {
    requireAccountContext(context);
    const fields = parseRpcRequest(listFields, request);
    const after = fields.page.cursor === undefined ? null : readCursor(fields.page.cursor);
    const rows = await this.prisma.auditLog.findMany({
      where: {
        occurredAt: { gte: fields.from, lte: fields.to },
        ...(fields.actorUserId === undefined ? {} : { actorUserId: fields.actorUserId }),
        ...(fields.action === undefined ? {} : { action: fields.action }),
        ...(fields.resourceType === undefined ? {} : { resourceType: fields.resourceType }),
        ...(fields.resourceId === undefined ? {} : { resourceId: fields.resourceId }),
        ...(after === null
          ? {}
          : {
              OR: [
                { occurredAt: { lt: after.occurredAt } },
                { occurredAt: after.occurredAt, id: { lt: after.id } },
              ],
            }),
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: fields.page.limit + 1,
      select: AUDIT_LOG_VIEW_SELECT,
    });
    const page = rows.slice(0, fields.page.limit);
    const last = page.at(-1);
    return {
      entries: page.map(toAuditLogEntry),
      page:
        rows.length > fields.page.limit && last !== undefined
          ? {
              nextCursor: encodeCursor({ id: last.id, key: last.occurredAt.toISOString() }),
            }
          : {},
    };
  }

  /** The action vocabulary, sorted — the build's list, not a scan of the table. */
  listAuditActions(context: RequestContext): identityGrpc.ListAuditActionsResponse {
    requireAccountContext(context);
    return { actions: SORTED_ACTIONS };
  }
}

/** The position a cursor names; malformed, or missing its instant, is `VALIDATION_FAILED`. */
function readCursor(cursor: string): { id: string; occurredAt: Date } {
  const position = decodeCursor(cursor);
  const occurredAt = position?.key === undefined ? null : new Date(position.key);
  if (position === null || occurredAt === null || Number.isNaN(occurredAt.getTime())) {
    throw rpcError('VALIDATION_FAILED', {
      issues: [{ path: '/page/cursor', code: 'invalid_format' }],
    });
  }
  return { id: position.id, occurredAt };
}
