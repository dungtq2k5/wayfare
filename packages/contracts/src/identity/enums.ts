/** An install's platform — rdm-spec I-2 `devices.platform`. */
export enum Platform {
  IOS = 'IOS',
  ANDROID = 'ANDROID',
  WEB = 'WEB',
}

/** Every `Platform` value, for validation. */
export const PLATFORMS = Object.values(Platform);

/** Why a session ended early — rdm-spec I-3 `sessions.revoked_reason`. */
export enum SessionRevokedReason {
  LOGOUT = 'LOGOUT',
  LOGOUT_ALL = 'LOGOUT_ALL',
  REPLAY_DETECTED = 'REPLAY_DETECTED',
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',
  LOCKED = 'LOCKED',
  ADMIN = 'ADMIN',
  ERASED = 'ERASED',
}

/** Every `SessionRevokedReason` value. */
export const SESSION_REVOKED_REASONS = Object.values(SessionRevokedReason);

/** Where an owner registration stands — rdm-spec I-8 `owner_registrations.status`. */
export enum OwnerRegistrationStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  WITHDRAWN = 'WITHDRAWN',
}

/** Every `OwnerRegistrationStatus` value. */
export const OWNER_REGISTRATION_STATUSES = Object.values(OwnerRegistrationStatus);

/** What a single-use emailed token is for — rdm-spec I-9 `action_tokens.purpose`. */
export enum ActionTokenPurpose {
  PASSWORD_RESET = 'PASSWORD_RESET',
  EMAIL_VERIFICATION = 'EMAIL_VERIFICATION',
  EMAIL_CHANGE = 'EMAIL_CHANGE',
  EMAIL_CHANGE_REVERT = 'EMAIL_CHANGE_REVERT',
  /** A new staff account's first-password link. */
  ACCOUNT_SETUP = 'ACCOUNT_SETUP',
  /** The link sent to the requested address once a recovery's hold has passed (rdm-spec I-14). */
  ACCOUNT_RECOVERY = 'ACCOUNT_RECOVERY',
}

/** Every `ActionTokenPurpose` value. */
export const ACTION_TOKEN_PURPOSES = Object.values(ActionTokenPurpose);

/** A legal document a user accepts — rdm-spec I-12 `legal_acceptances.document`. */
export enum LegalDocument {
  TERMS_OF_SERVICE = 'TERMS_OF_SERVICE',
  PRIVACY_POLICY = 'PRIVACY_POLICY',
  OWNER_AGREEMENT = 'OWNER_AGREEMENT',
}

/** Every `LegalDocument` value. */
export const LEGAL_DOCUMENTS = Object.values(LegalDocument);

/** Where an account recovery stands — rdm-spec I-14 `account_recoveries.status`. */
export enum AccountRecoveryStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  ON_HOLD = 'ON_HOLD',
  LINK_SENT = 'LINK_SENT',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

/** Every `AccountRecoveryStatus` value. */
export const ACCOUNT_RECOVERY_STATUSES = Object.values(AccountRecoveryStatus);

/** A check an admin performed before opening a recovery — rdm-spec I-14 `evidence_codes`. */
export enum RecoveryEvidenceCode {
  PHONE_CALLBACK = 'PHONE_CALLBACK',
  BUSINESS_DETAILS_MATCH = 'BUSINESS_DETAILS_MATCH',
  BILLING_KNOWLEDGE = 'BILLING_KNOWLEDGE',
}

/** Every `RecoveryEvidenceCode` value. */
export const RECOVERY_EVIDENCE_CODES = Object.values(RecoveryEvidenceCode);
