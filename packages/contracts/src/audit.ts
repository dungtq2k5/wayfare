/** Audited actions, past tense (rdm-spec I-11 `action`). */
export enum AuditAction {
  DEVICE_REGISTERED = 'DEVICE_REGISTERED',
}

/** Every `AuditAction` value. */
export const AUDIT_ACTIONS = Object.values(AuditAction);

/** Resource kinds an audit row can point at (rdm-spec I-11 `resource_type`). */
export enum AuditResourceType {
  DEVICE = 'DEVICE',
}

/** Every `AuditResourceType` value. */
export const AUDIT_RESOURCE_TYPES = Object.values(AuditResourceType);

/** Who performed an audited action (rdm-spec I-11 `actor_type`). */
export enum AuditActorType {
  USER = 'USER',
  DEVICE = 'DEVICE',
  SYSTEM = 'SYSTEM',
  STRIPE = 'STRIPE',
}

/** Every `AuditActorType` value. */
export const AUDIT_ACTOR_TYPES = Object.values(AuditActorType);

/** The fields an action may record in `metadata`, per section. */
export interface AuditMetadataAllowlist {
  readonly before?: readonly string[];
  readonly after?: readonly string[];
  readonly reason?: boolean;
}

/**
 * Per-action allowlist for `audit_logs.metadata` (rdm-spec I-11, conventions §9.4).
 * Never an email address, a name or a phone number — audit rows identify people by id only.
 */
export const AUDIT_METADATA_ALLOWLIST: Readonly<Record<AuditAction, AuditMetadataAllowlist>> = {
  [AuditAction.DEVICE_REGISTERED]: { after: ['platform', 'appVersion'] },
};

/** Upper bound of `audit_logs.user_agent`. */
export const MAX_USER_AGENT_LENGTH = 512;

/** Upper bound of `audit_logs.ip` — an IPv6 address in text form. */
export const MAX_IP_LENGTH = 45;
