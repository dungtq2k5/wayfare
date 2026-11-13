import { AuditActorType } from '@wayfare/contracts';
import type {
  AUDIT_RECORD,
  AuditAction,
  AuditRecordPayload,
  AuditResourceType,
  EventInput,
} from '@wayfare/contracts';

/** Who acted: a staff member or an owner, billing itself, or Stripe through its webhook. */
export type BillingAuditActor =
  | { readonly type: AuditActorType.USER; readonly userId: string }
  | { readonly type: AuditActorType.SYSTEM }
  | { readonly type: AuditActorType.STRIPE };

/** The origin fields an audit row keeps (conventions §4.2). */
export interface BillingAuditOrigin {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

/** No request: a consumer, a job, the webhook worker. */
export const NO_ORIGIN: BillingAuditOrigin = { ip: null, userAgent: null };

/** The `audit.record` input billing writes (rdm-spec I-11). */
export function billingAuditRecord(facts: {
  readonly actor: BillingAuditActor;
  readonly action: AuditAction;
  readonly resource: { readonly type: AuditResourceType; readonly id: string };
  readonly metadata?: AuditRecordPayload['metadata'];
  readonly origin: BillingAuditOrigin;
  readonly now: Date;
}): EventInput<typeof AUDIT_RECORD> {
  return {
    occurredAt: facts.now.toISOString(),
    service: 'billing',
    actor:
      facts.actor.type === AuditActorType.USER
        ? { type: facts.actor.type, userId: facts.actor.userId }
        : { type: facts.actor.type },
    action: facts.action,
    resource: { type: facts.resource.type, id: facts.resource.id },
    metadata: facts.metadata ?? {},
    ...(facts.origin.ip === null ? {} : { ip: facts.origin.ip }),
    ...(facts.origin.userAgent === null ? {} : { userAgent: facts.origin.userAgent }),
  };
}
