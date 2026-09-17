import { AuditActorType, AuditResourceType, zUuidV7 } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** One audit row (api-endpoints-plan §1.8, rdm-spec I-11). */
export const auditLogResponseSchema = z.object({
  id: zUuidV7,
  /** The producer's clock. */
  occurredAt: z.iso.datetime({ offset: true }),
  service: z.string(),
  actor: z.object({
    type: z.enum(AuditActorType),
    userId: z.string().nullable(),
    deviceId: z.string().nullable(),
  }),
  /** A string, not the enum: a stored action may have left the vocabulary (conventions §6.3). */
  action: z.string(),
  resource: z.object({ type: z.enum(AuditResourceType), id: z.string().nullable() }),
  /** `{ before?, after?, reason? }` — allowlisted fields only. */
  metadata: z.record(z.string(), z.unknown()),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
});

/** What `GET /admin/audit-logs` returns per item. */
export class AuditLogResponseDto extends createZodDto(auditLogResponseSchema) {}

/** One action of the vocabulary. */
export const auditActionResponseSchema = z.string();

/** A class cannot wrap a primitive; the schema stays a plain string. */
const actionItemSchema: z.ZodType<NonNullable<unknown>> = auditActionResponseSchema;

/** What `GET /admin/audit-logs/actions` returns per item — documented and validated as a string. */
export class AuditActionResponseDto extends createZodDto(actionItemSchema) {}
