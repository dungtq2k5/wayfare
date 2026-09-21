import { AuditAction } from './vocabulary';

/** The fields an action may record in `metadata`, per section. */
export interface AuditMetadataAllowlist {
  readonly before?: readonly string[];
  readonly after?: readonly string[];
  readonly reason?: boolean;
}

/**
 * Per-action allowlist for `audit_logs.metadata` (rdm-spec I-11, conventions §9.4). Never an email
 * address, a name or a phone number — audit rows identify people by id only. An action starts
 * empty, and the change that first emits it widens its own entry.
 */
export const AUDIT_METADATA_ALLOWLIST: Readonly<Record<AuditAction, AuditMetadataAllowlist>> = {
  [AuditAction.DEVICE_REGISTERED]: { after: ['platform', 'appVersion'] },
  [AuditAction.USER_REGISTERED]: { after: ['preferredLocale', 'client'] },
  [AuditAction.USER_LOGIN]: { after: ['client', 'deviceClaimed'] },
  [AuditAction.USER_LOGIN_FAILED]: { after: ['client', 'failure'] },
  [AuditAction.USER_LOGOUT]: { after: ['byRefreshToken'] },
  [AuditAction.USER_LOGOUT_ALL]: { after: ['revokedFamilies'] },
  [AuditAction.REFRESH_TOKEN_REPLAY_DETECTED]: { after: ['client', 'revokedFamilies'] },
  [AuditAction.PASSWORD_RESET_REQUESTED]: { after: ['found'] },
  [AuditAction.PASSWORD_RESET_COMPLETED]: { after: ['purpose', 'hadPassword', 'revokedFamilies'] },
  [AuditAction.PASSWORD_CHANGED]: { after: ['revokedFamilies'] },
  [AuditAction.EMAIL_VERIFIED]: {},
  [AuditAction.EMAIL_CHANGED]: {},
  [AuditAction.EMAIL_CHANGE_REVERTED]: { after: ['revokedFamilies'] },
  [AuditAction.DEVICE_CLAIMED]: { before: ['previouslyClaimed'] },
  [AuditAction.USER_ERASED]: {},
  [AuditAction.OWNER_REGISTRATION_SUBMITTED]: { after: ['status'] },
  [AuditAction.OWNER_REGISTRATION_WITHDRAWN]: { before: ['status'] },
  // Whether each note was written, never its text.
  [AuditAction.OWNER_REGISTRATION_APPROVED]: {
    after: ['status', 'hasDecisionNote', 'hasInternalNote'],
  },
  [AuditAction.OWNER_REGISTRATION_REJECTED]: {
    after: ['status', 'hasDecisionNote', 'hasInternalNote'],
  },
  [AuditAction.OWNER_NATIONAL_ID_REVEALED]: {},
  [AuditAction.OWNER_PII_REDACTED]: {},
  [AuditAction.STAFF_USER_CREATED]: { after: ['roleCodes'] },
  [AuditAction.EMAIL_ADDRESS_CHECKED]: { after: ['matches'] },
  [AuditAction.USER_UPDATED]: { after: ['changedFields'] },
  [AuditAction.USER_ROLES_UPDATED]: { before: ['roleCodes'], after: ['roleCodes'] },
  [AuditAction.USER_LOCKED]: { after: ['lockedUntil'], reason: true },
  [AuditAction.USER_UNLOCKED]: { before: ['lockedUntil'] },
  [AuditAction.USER_DEACTIVATED]: {
    after: ['wasOwner', 'refundUnredeemedVouchers', 'revokedFamilies'],
    reason: true,
  },
  [AuditAction.USER_RESTORED]: {},
  [AuditAction.USER_SESSIONS_REVOKED]: { after: ['revokedFamilies'] },
  [AuditAction.ROLE_CREATED]: { after: ['code', 'name', 'permissionCodes'] },
  [AuditAction.ROLE_UPDATED]: { before: ['name', 'description'], after: ['name', 'description'] },
  [AuditAction.ROLE_PERMISSIONS_UPDATED]: {
    before: ['permissionCodes'],
    after: ['permissionCodes', 'holders'],
  },
  [AuditAction.ROLE_DELETED]: { before: ['code', 'name', 'permissionCodes'] },
  // The codes and the ticket, never the requested address (rdm-spec I-14).
  [AuditAction.ACCOUNT_RECOVERY_OPENED]: { after: ['evidenceCodes', 'supportReference'] },
  [AuditAction.ACCOUNT_RECOVERY_APPROVED]: { after: ['holdUntil'] },
  [AuditAction.ACCOUNT_RECOVERY_REJECTED]: { after: ['hasDecisionNote'] },
  [AuditAction.ACCOUNT_RECOVERY_CANCELLED_BY_OWNER]: { after: ['bySignedInOwner'] },
  [AuditAction.ACCOUNT_RECOVERY_COMPLETED]: { before: ['status'] },
  [AuditAction.ACCOUNT_RECOVERY_EXPIRED]: { before: ['status'] },
  [AuditAction.SUBMISSION_CREATED]: { after: ['kind', 'placeId'] },
  [AuditAction.SUBMISSION_SUPERSEDED]: { before: ['status'] },
  [AuditAction.SUBMISSION_WITHDRAWN]: { before: ['status'] },
  // Whether each note was written, never its text.
  [AuditAction.SUBMISSION_APPROVED]: {
    after: [
      'kind',
      'placeId',
      'triggerRadiusM',
      'narrationPriority',
      'categoryCode',
      'categoryOverridden',
      'conflictAcknowledged',
      'hasDecisionNote',
      'hasInternalNote',
    ],
  },
  [AuditAction.SUBMISSION_REJECTED]: { after: ['hasDecisionNote', 'hasInternalNote'] },
  [AuditAction.PLACE_DEACTIVATED_BY_OWNER]: {
    before: ['status', 'inactiveReason'],
    after: ['status', 'inactiveReason'],
  },
  [AuditAction.PLACE_REACTIVATED]: {
    before: ['status', 'inactiveReason'],
    after: ['status', 'inactiveReason'],
  },
  [AuditAction.PLACE_CREATED]: {
    after: ['kind', 'status', 'categoryCode', 'areaCode', 'publicCode'],
  },
  [AuditAction.PLACE_EDITED]: { after: ['changedFields', 'contentChanged'] },
  [AuditAction.PLACE_EDITORIAL_UPDATED]: {
    before: ['triggerRadiusM', 'narrationPriority'],
    after: ['triggerRadiusM', 'narrationPriority'],
  },
  [AuditAction.PLACE_PHOTOS_REPLACED]: { after: ['photoCount'] },
  [AuditAction.PLACE_MENU_REPLACED]: { after: ['itemCount', 'menuCurrency'] },
  [AuditAction.PLACE_HOURS_REPLACED]: { after: ['rowCount'] },
  [AuditAction.PLACE_ACTIVATION_REQUESTED]: { after: ['status', 'missing'] },
  [AuditAction.PLACE_ACTIVATED]: {},
  [AuditAction.PLACE_DEACTIVATED]: { before: ['status'], reason: true },
  [AuditAction.PLACE_DELETED]: { before: ['status'] },
  [AuditAction.PLACE_RESTORED]: { before: ['status'] },
  [AuditAction.TOUR_CREATED]: {},
  [AuditAction.TOUR_UPDATED]: {},
  [AuditAction.TOUR_STOPS_REPLACED]: {},
  [AuditAction.TOUR_ACTIVATED]: {},
  [AuditAction.TOUR_DEACTIVATED]: {},
  [AuditAction.TOUR_DELETED]: {},
  [AuditAction.TOUR_RESTORED]: {},
  [AuditAction.CATEGORY_CREATED]: { after: ['code', 'appliesTo', 'icon', 'sortOrder'] },
  [AuditAction.CATEGORY_UPDATED]: {
    before: ['appliesTo', 'icon', 'sortOrder', 'isActive'],
    after: ['appliesTo', 'icon', 'sortOrder', 'isActive'],
  },
  [AuditAction.AREA_CREATED]: { after: ['code', 'nameVi', 'defaultZoom', 'sortOrder', 'isActive'] },
  // Whether the geometry moved, never the geometry itself.
  [AuditAction.AREA_UPDATED]: {
    before: ['nameVi', 'defaultZoom', 'sortOrder', 'isActive'],
    after: ['nameVi', 'defaultZoom', 'sortOrder', 'isActive', 'boundaryChanged', 'centerChanged'],
  },
  [AuditAction.MAP_PACK_REGISTERED]: { after: ['areaId', 'version', 'pmtilesBytes', 'buildTool'] },
  [AuditAction.MAP_PACK_PUBLISHED]: { before: ['previousVersion'], after: ['version'] },
  [AuditAction.SYNTHESIS_JOB_CREATED]: {
    after: ['targetType', 'targetId', 'trigger', 'langs', 'includeAudio'],
  },
  [AuditAction.SYNTHESIS_JOB_PAUSED]: { before: ['status'] },
  [AuditAction.SYNTHESIS_JOB_RESUMED]: { before: ['status'] },
  [AuditAction.SYNTHESIS_JOB_CANCELLED]: { before: ['status'] },
  [AuditAction.SYNTHESIS_JOB_RETRIED]: { after: ['retriedTasks'] },
  [AuditAction.PRONUNCIATION_CREATED]: {
    after: ['term', 'targetLang', 'replacementType', 'isActive'],
  },
  [AuditAction.PRONUNCIATION_UPDATED]: {
    after: ['term', 'targetLang', 'replacementType', 'isActive'],
  },
  [AuditAction.PRONUNCIATION_DELETED]: { before: ['term', 'targetLang'] },
  // Never the corrected text itself.
  [AuditAction.LOCALIZATION_EDITED]: {
    after: ['targetType', 'targetId', 'lang', 'sourceContentHash'],
  },
  [AuditAction.LOCALIZATION_REVERTED]: { before: ['lang', 'sourceContentHash'] },
  [AuditAction.BILLING_CHECKOUT_STARTED]: { after: ['planPriceId'] },
  [AuditAction.BILLING_PORTAL_OPENED]: {},
  [AuditAction.BOOSTS_UPDATED]: {},
  [AuditAction.PAYOUT_ACCOUNT_CREATED]: {},
  [AuditAction.ENTITLEMENTS_OVERRIDDEN]: { before: ['grants'], after: ['grants'], reason: true },
  [AuditAction.ENTITLEMENTS_UNPINNED]: { reason: true },
  [AuditAction.BILLING_SUBSCRIPTION_CHANGED]: {
    before: ['subscriptionStatus', 'planCode'],
    after: ['subscriptionStatus', 'planCode'],
  },
  [AuditAction.BILLING_ENTITLEMENTS_APPLIED]: { after: ['entitlementsVersion'] },
  [AuditAction.VOUCHER_OFFER_CREATED]: {},
  [AuditAction.VOUCHER_OFFER_UPDATED]: {},
  [AuditAction.VOUCHER_OFFER_SUBMITTED]: {},
  [AuditAction.VOUCHER_OFFER_PAUSED]: {},
  [AuditAction.VOUCHER_OFFER_ARCHIVED]: {},
  [AuditAction.VOUCHER_OFFER_APPROVED]: {},
  [AuditAction.VOUCHER_OFFER_REJECTED]: {},
  [AuditAction.VOUCHER_REDEEMED]: {},
  [AuditAction.VOUCHER_REISSUED]: {},
  [AuditAction.STAFF_INVITED]: {},
  [AuditAction.STAFF_INVITATION_ACCEPTED]: {},
  [AuditAction.STAFF_SCOPE_UPDATED]: {},
  [AuditAction.STAFF_REVOKED]: {},
  [AuditAction.PLAN_CREATED]: { after: ['code', 'grants'] },
  [AuditAction.PLAN_UPDATED]: { after: ['code', 'grants'] },
  [AuditAction.PLAN_PRICE_REGISTERED]: { after: ['billingInterval', 'amountMinor'] },
  [AuditAction.PLAN_APPLIED]: { after: ['affected', 'skippedPinned', 'failed'] },
  [AuditAction.PLAN_RETIRED]: { before: ['code'] },
  [AuditAction.REFUND_CREATED]: {},
  [AuditAction.ORDER_PAID]: {},
  [AuditAction.ORDER_REFUNDED]: {},
  [AuditAction.DISPUTE_OPENED]: {},
  [AuditAction.BILLING_EVENT_REPLAYED]: { after: ['eventType'] },
  [AuditAction.BILLING_WEBHOOK_FAILED]: { after: ['eventType'] },
};
