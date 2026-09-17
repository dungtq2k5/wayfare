import type {
  AuditAction,
  AuditActorType,
  AuditRecordPayload,
  AuditResourceType,
  EventInput,
  AUDIT_RECORD,
} from '@wayfare/contracts';

/** The origin fields an audit row keeps (conventions §4.2). */
export interface AuditOrigin {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

/** What a use case says about the audited act. */
export interface AuditFacts {
  readonly actor: {
    readonly type: AuditActorType;
    readonly userId?: string;
    readonly deviceId?: string;
  };
  readonly action: AuditAction;
  readonly resource: { readonly type: AuditResourceType; readonly id?: string };
  readonly metadata?: AuditRecordPayload['metadata'];
  readonly origin: AuditOrigin;
  readonly now: Date;
}

/** The `audit.record` input identity writes to its outbox (rdm-spec I-11). */
export function auditRecord(facts: AuditFacts): EventInput<typeof AUDIT_RECORD> {
  return {
    occurredAt: facts.now.toISOString(),
    service: 'identity',
    actor: { ...facts.actor },
    action: facts.action,
    resource: { ...facts.resource },
    metadata: facts.metadata ?? {},
    ...(facts.origin.ip === null ? {} : { ip: facts.origin.ip }),
    ...(facts.origin.userAgent === null ? {} : { userAgent: facts.origin.userAgent }),
  };
}
