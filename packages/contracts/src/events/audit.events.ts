import { z } from 'zod';
import { AUDIT_METADATA_ALLOWLIST } from '../audit/allowlist';
import {
  AUDIT_ACTION_RESOURCE,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  MAX_IP_LENGTH,
  MAX_USER_AGENT_LENGTH,
} from '../audit/vocabulary';
import { zUuidV7 } from '../common/ids';
import { defineEvent, zEventInstant } from './event-definition';

const auditSection = z.record(z.string(), z.unknown());

/** Checks each metadata section only carries the fields allowlisted for its action. */
function checkMetadataAllowlist(
  payload: { action: AuditAction; metadata: { before?: object; after?: object; reason?: string } },
  ctx: z.RefinementCtx,
): void {
  const allowlist = AUDIT_METADATA_ALLOWLIST[payload.action];
  for (const section of ['before', 'after'] as const) {
    const value = payload.metadata[section];
    if (value === undefined) continue;
    const allowed = new Set(allowlist[section] ?? []);
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['metadata', section, key],
          message: `Field not allowlisted for ${payload.action}`,
        });
      }
    }
  }
  if (payload.metadata.reason !== undefined && !allowlist.reason) {
    ctx.addIssue({
      code: 'custom',
      path: ['metadata', 'reason'],
      message: `No reason allowed for ${payload.action}`,
    });
  }
}

/** The resource must be the one its action names, and an anonymous actor carries no id. */
function checkResourceAndActor(
  payload: {
    action: AuditAction;
    actor: { type: AuditActorType; userId?: string; deviceId?: string };
    resource: { type: AuditResourceType };
  },
  ctx: z.RefinementCtx,
): void {
  const expected = AUDIT_ACTION_RESOURCE[payload.action];
  if (payload.resource.type !== expected) {
    ctx.addIssue({
      code: 'custom',
      path: ['resource', 'type'],
      message: `${payload.action} is about a ${expected}`,
    });
  }
  if (
    payload.actor.type === AuditActorType.ANONYMOUS &&
    (payload.actor.userId !== undefined || payload.actor.deviceId !== undefined)
  ) {
    ctx.addIssue({ code: 'custom', path: ['actor'], message: 'An anonymous actor has no id' });
  }
}

/** Payload of `audit.record` (api-endpoints-plan §10, rdm-spec I-11). */
export const auditRecordPayloadSchema = z
  .object({
    eventId: zUuidV7,
    occurredAt: zEventInstant,
    service: z.string().min(1).max(32),
    actor: z
      .object({
        type: z.enum(AuditActorType),
        userId: zUuidV7.optional(),
        deviceId: zUuidV7.optional(),
      })
      .strict(),
    action: z.enum(AuditAction),
    resource: z
      .object({
        type: z.enum(AuditResourceType),
        id: zUuidV7.optional(),
      })
      .strict(),
    metadata: z
      .object({
        before: auditSection.optional(),
        after: auditSection.optional(),
        reason: z.string().max(500).optional(),
      })
      .strict()
      .default({}),
    ip: z.string().max(MAX_IP_LENGTH).optional(),
    userAgent: z.string().max(MAX_USER_AGENT_LENGTH).optional(),
  })
  .strict()
  .superRefine(checkMetadataAllowlist)
  .superRefine(checkResourceAndActor);

/** A validated `audit.record` payload. */
export type AuditRecordPayload = z.output<typeof auditRecordPayloadSchema>;

/**
 * The aggregate an audit event is about: its resource, else its actor, else the event itself — a
 * failed login for an unknown email has neither (rdm-spec §2.10). Never throws.
 */
export function auditAggregateId(payload: {
  eventId: string;
  actor: { userId?: string; deviceId?: string };
  resource: { id?: string };
}): string {
  return payload.resource.id ?? payload.actor.userId ?? payload.actor.deviceId ?? payload.eventId;
}

/** `audit.record` — published by every service, consumed by identity into `audit_logs`. */
export const AUDIT_RECORD = defineEvent({
  subject: 'audit.record',
  publisher: 'any',
  stream: 'AUDIT',
  schema: auditRecordPayloadSchema,
  aggregateId: auditAggregateId,
});
