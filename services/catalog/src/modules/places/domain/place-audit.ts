import { AuditActorType, AuditResourceType } from '@wayfare/contracts';
import type { AUDIT_RECORD, AuditAction, AuditRecordPayload, EventInput } from '@wayfare/contracts';

/** Who acted: a staff account, or catalog itself (a consumer opening the gate). */
export type PlaceAuditActor =
  | { readonly type: AuditActorType.USER; readonly userId: string }
  | { readonly type: AuditActorType.SYSTEM };

/** The origin fields an audit row keeps (conventions §4.2). */
export interface PlaceAuditOrigin {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

/** The `audit.record` input catalog writes for a Place (api-endpoints-plan §3.5, rdm-spec I-11). */
export function placeAuditRecord(facts: {
  readonly actor: PlaceAuditActor;
  readonly action: AuditAction;
  readonly placeId: string;
  readonly metadata?: AuditRecordPayload['metadata'];
  readonly origin: PlaceAuditOrigin;
  readonly now: Date;
}): EventInput<typeof AUDIT_RECORD> {
  return {
    occurredAt: facts.now.toISOString(),
    service: 'catalog',
    actor:
      facts.actor.type === AuditActorType.USER
        ? { type: facts.actor.type, userId: facts.actor.userId }
        : { type: facts.actor.type },
    action: facts.action,
    resource: { type: AuditResourceType.PLACE, id: facts.placeId },
    metadata: facts.metadata ?? {},
    ...(facts.origin.ip === null ? {} : { ip: facts.origin.ip }),
    ...(facts.origin.userAgent === null ? {} : { userAgent: facts.origin.userAgent }),
  };
}

/** The `audit.record` input catalog writes for a submission (api-endpoints-plan §3.3, §3.4). */
export function submissionAuditRecord(facts: {
  readonly actor: PlaceAuditActor;
  readonly action: AuditAction;
  readonly submissionId: string;
  readonly metadata?: AuditRecordPayload['metadata'];
  readonly origin: PlaceAuditOrigin;
  readonly now: Date;
}): EventInput<typeof AUDIT_RECORD> {
  return {
    ...placeAuditRecord({ ...facts, placeId: facts.submissionId }),
    resource: { type: AuditResourceType.SUBMISSION, id: facts.submissionId },
  };
}

/** The `audit.record` input catalog writes for a category, an area or a map pack (api-endpoints-plan §3.6). */
export function taxonomyAuditRecord(facts: {
  readonly actor: PlaceAuditActor;
  readonly action: AuditAction;
  readonly resource:
    AuditResourceType.CATEGORY | AuditResourceType.AREA | AuditResourceType.MAP_PACK;
  readonly resourceId: string;
  readonly metadata?: AuditRecordPayload['metadata'];
  readonly origin: PlaceAuditOrigin;
  readonly now: Date;
}): EventInput<typeof AUDIT_RECORD> {
  return {
    ...placeAuditRecord({ ...facts, placeId: facts.resourceId }),
    resource: { type: facts.resource, id: facts.resourceId },
  };
}
