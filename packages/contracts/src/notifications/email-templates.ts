import { z } from 'zod';
import { RefundReason } from '../billing/enums';
import { MAX_OFFER_TITLE_LENGTH, MAX_VOUCHERS_PER_ORDER } from '../billing/limits';
import { zUuidV7 } from '../common/ids';
import { entitlementsReducedData, zDecisionNote } from './data';
import { EmailTemplate } from './types';

const zInstant = z.iso.datetime({ offset: true });

/** A raw single-use token. Exists only in memory between the trigger and the provider call (ADR 0049). */
const zToken = z.string().min(1).max(256);

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

const tokenOnly = z.object({ token: zToken }).strict();

/**
 * Each email template's data (rdm-spec I-13). The token fields are never stored — not in I-13 and
 * not in a queued job: a send that must retry re-issues its token instead (ADR 0049).
 */
export const EMAIL_TEMPLATE_DATA = {
  [EmailTemplate.EMAIL_VERIFICATION]: tokenOnly,
  [EmailTemplate.PASSWORD_RESET]: tokenOnly,
  [EmailTemplate.EMAIL_CHANGE]: tokenOnly,
  // `newEmailMasked` is `maskEmail()` output, never the address.
  [EmailTemplate.EMAIL_CHANGED_NOTICE]: z
    .object({ revertToken: zToken, newEmailMasked: z.string().min(1).max(254) })
    .strict(),
  [EmailTemplate.STAFF_INVITE]: z
    .object({
      membershipId: zUuidV7,
      sellerName: z.string().min(1).max(MAX_SELLER_NAME_LENGTH),
      inviteToken: zToken,
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
  // Tokens only on the stages that carry a link.
  [EmailTemplate.ACCOUNT_RECOVERY_NOTICE]: z
    .object({
      recoveryId: zUuidV7,
      stage: z.enum(ACCOUNT_RECOVERY_NOTICE_STAGES),
      holdUntil: zInstant.optional(),
      cancelToken: zToken.optional(),
      completionToken: zToken.optional(),
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
