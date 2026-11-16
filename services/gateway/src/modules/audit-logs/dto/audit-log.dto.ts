import {
  AUDIT_QUERY_MAX_DAYS,
  AuditResourceType,
  zAuditActionFilter,
  zCursorQuery,
  zUuidV7,
} from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const DAY_MS = 86_400_000;
const zInstant = z.iso.datetime({ offset: true });

/**
 * `GET /admin/audit-logs` query (api-endpoints-plan §1.8): a required window of at most
 * `AUDIT_QUERY_MAX_DAYS`. `action` is any upper-snake string, so a retired action can be typed.
 */
export const listAuditLogsQuerySchema = zCursorQuery
  .extend({
    from: zInstant,
    to: zInstant,
    actorUserId: zUuidV7.optional(),
    action: zAuditActionFilter.optional(),
    resourceType: z.enum(AuditResourceType).optional(),
    resourceId: zUuidV7.optional(),
  })
  .refine((query) => Date.parse(query.to) > Date.parse(query.from), {
    path: ['to'],
    message: 'Must be after from',
  })
  .refine(
    (query) => Date.parse(query.to) - Date.parse(query.from) <= AUDIT_QUERY_MAX_DAYS * DAY_MS,
    {
      path: ['to'],
      message: `At most ${AUDIT_QUERY_MAX_DAYS} days after from`,
    },
  );

/** Validated `GET /admin/audit-logs` query. */
export class ListAuditLogsQueryDto extends createZodDto(listAuditLogsQuerySchema) {}
