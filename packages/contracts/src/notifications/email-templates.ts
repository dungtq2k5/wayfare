import { z } from 'zod';
import { RefundReason } from '../billing/enums';
import { MAX_OFFER_TITLE_LENGTH, MAX_VOUCHERS_PER_ORDER } from '../billing/limits';
import { MAX_IP_LENGTH } from '../audit/vocabulary';
import { zUuidV7 } from '../common/ids';
import { MAX_ROLE_NAME_LENGTH } from '../identity/limits';
import { entitlementsReducedData, zDecisionNote } from './data';
import { EmailTemplate } from './types';

const zInstant = z.iso.datetime({ offset: true });

/** A reviewer's decision, as the outcome emails report it. */
export const zReviewDecision = z.enum(['APPROVED', 'REJECTED']);

/** The stages of an account recovery that email the owner (api-endpoints-plan §1.10). */
export const ACCOUNT_RECOVERY_NOTICE_STAGES = [
  'HOLD_STARTED',
  'LINK_SENT',
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
] as const;

/** Upper bound of a seller's display name — the registered business name (rdm-spec I-8 `business_name`). */
export const MAX_SELLER_NAME_LENGTH = 160;

const empty = z.object({}).strict();

/**
 * Each email template's data (rdm-spec I-13). **No template carries a token:** links reach the
 * renderer as built URLs (conventions §11.4), so no message can interpolate one.
 */
export const EMAIL_TEMPLATE_DATA = {
  [EmailTemplate.EMAIL_VERIFICATION]: empty,
  [EmailTemplate.PASSWORD_RESET]: empty,
  // Role names, never the inviter's name (conventions §9.4).
  [EmailTemplate.ACCOUNT_SETUP]: z
    .object({ inviterRoleNames: z.array(z.string().min(1).max(MAX_ROLE_NAME_LENGTH)).max(20) })
    .strict(),
  [EmailTemplate.EMAIL_CHANGE]: empty,
  // `newEmailMasked` is `maskEmail()` output, never the address; the IP helps a victim recognise an attack.
  [EmailTemplate.EMAIL_CHANGED_NOTICE]: z
    .object({
      newEmailMasked: z.string().min(1).max(254),
      requestIp: z.string().max(MAX_IP_LENGTH).optional(),
    })
    .strict(),
  [EmailTemplate.STAFF_INVITE]: z
    .object({
      membershipId: zUuidV7,
      sellerName: z.string().min(1).max(MAX_SELLER_NAME_LENGTH),
      expiresAt: zInstant,
    })
    .strict(),
  [EmailTemplate.OWNER_REGISTRATION_OUTCOME]: z
    .object({
      registrationId: zUuidV7,
      decision: zReviewDecision,
      decisionNote: zDecisionNote.optional(),
    })
    .strict(),
  [EmailTemplate.SUBMISSION_OUTCOME]: z
    .object({
      submissionId: zUuidV7,
      placeId: zUuidV7.optional(),
      decision: zReviewDecision,
      decisionNote: zDecisionNote.optional(),
    })
    .strict(),
  [EmailTemplate.PAYMENT_FAILED]: z
    .object({ attemptCount: z.number().int().min(1), nextAttemptAt: zInstant.optional() })
    .strict(),
  [EmailTemplate.ENTITLEMENTS_REDUCED]: entitlementsReducedData,
  [EmailTemplate.ACCOUNT_RECOVERY_NOTICE]: z
    .object({
      recoveryId: zUuidV7,
      stage: z.enum(ACCOUNT_RECOVERY_NOTICE_STAGES),
      holdUntil: zInstant.optional(),
    })
    .strict(),
  [EmailTemplate.VOUCHER_MOVED]: z
    .object({ voucherId: zUuidV7, offerTitle: z.string().min(1).max(MAX_OFFER_TITLE_LENGTH) })
    .strict(),
  [EmailTemplate.VOUCHER_REFUNDED]: z
    .object({
      orderId: zUuidV7,
      voucherCount: z.number().int().min(1).max(MAX_VOUCHERS_PER_ORDER),
      reason: z.enum(RefundReason),
    })
    .strict(),
} as const satisfies Record<EmailTemplate, z.ZodType>;

/** One template's data. */
export type EmailTemplateData<T extends EmailTemplate> = z.input<(typeof EMAIL_TEMPLATE_DATA)[T]>;

/** A link slot a template renders: its main button, and a cancel link where there is one. */
export type EmailLinkSlot = 'action' | 'cancel';

/** The links each template needs; the send input must supply exactly these. */
export const EMAIL_TEMPLATE_LINKS = {
  [EmailTemplate.EMAIL_VERIFICATION]: ['action'],
  [EmailTemplate.PASSWORD_RESET]: ['action'],
  [EmailTemplate.ACCOUNT_SETUP]: ['action'],
  [EmailTemplate.EMAIL_CHANGE]: ['action'],
  [EmailTemplate.EMAIL_CHANGED_NOTICE]: ['action'],
  [EmailTemplate.STAFF_INVITE]: ['action'],
  [EmailTemplate.OWNER_REGISTRATION_OUTCOME]: ['action'],
  [EmailTemplate.SUBMISSION_OUTCOME]: ['action'],
  [EmailTemplate.PAYMENT_FAILED]: [],
  [EmailTemplate.ENTITLEMENTS_REDUCED]: ['action'],
  [EmailTemplate.ACCOUNT_RECOVERY_NOTICE]: ['action', 'cancel'],
  [EmailTemplate.VOUCHER_MOVED]: ['action'],
  [EmailTemplate.VOUCHER_REFUNDED]: ['action'],
} as const satisfies Record<EmailTemplate, readonly EmailLinkSlot[]>;

/** The link slots of one template. */
export type EmailTemplateLinkSlot<T extends EmailTemplate> =
  (typeof EMAIL_TEMPLATE_LINKS)[T][number];

/**
 * Templates an earlier bounce or complaint never suppresses (conventions §11.4) — a person must
 * always be able to verify, recover or defend their account.
 */
export const EMAIL_SECURITY_TEMPLATES: ReadonlySet<EmailTemplate> = new Set([
  EmailTemplate.EMAIL_VERIFICATION,
  EmailTemplate.PASSWORD_RESET,
  EmailTemplate.ACCOUNT_SETUP,
  EmailTemplate.EMAIL_CHANGE,
  EmailTemplate.EMAIL_CHANGED_NOTICE,
  EmailTemplate.ACCOUNT_RECOVERY_NOTICE,
]);
