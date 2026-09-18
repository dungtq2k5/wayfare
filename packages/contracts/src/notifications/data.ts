import { z } from 'zod';
import { MAX_VOUCHERS_PER_ORDER } from '../billing/limits';
import { PlaceInactiveReason } from '../catalog/enums';
import { MAX_DECISION_NOTE_LENGTH } from '../catalog/limits';
import { zUuidV7 } from '../common/ids';
import { zLanguage } from '../common/languages';
import type { LimitDimension } from '../entitlements/ceilings';
import { NotificationType } from './types';

/** An instant on the wire. */
const zInstant = z.iso.datetime({ offset: true });

/** A reviewer's note, shown to the applicant. */
export const zDecisionNote = z.string().min(1).max(MAX_DECISION_NOTE_LENGTH);

/** The grants a narrowing can reduce, for `reduced` lists. */
export const zLimitDimension = z.enum([
  'maxPlaces',
  'maxPhotosPerPlace',
  'maxMenuItemsPerPlace',
  'discoveryBoostSlots',
  'aiCreditsPerDay',
] as const satisfies readonly LimitDimension[]);

const LIMIT_DIMENSION_COUNT = zLimitDimension.options.length;

/** What an `ENTITLEMENTS_REDUCED` notification or email says was lost. */
export const entitlementsReducedData = z
  .object({
    entitlementsVersion: z.number().int().min(1),
    reduced: z.array(zLimitDimension).max(LIMIT_DIMENSION_COUNT),
    autoNarrationLost: z.boolean().optional(),
    vouchersLost: z.boolean().optional(),
  })
  .strict();

const registrationDecision = z
  .object({ registrationId: zUuidV7, decisionNote: zDecisionNote.optional() })
  .strict();
const submissionDecision = z
  .object({
    submissionId: zUuidV7,
    placeId: zUuidV7.optional(),
    decisionNote: zDecisionNote.optional(),
  })
  .strict();
const offerDecision = z
  .object({ offerId: zUuidV7, decisionNote: zDecisionNote.optional() })
  .strict();
const placeOnly = z.object({ placeId: zUuidV7 }).strict();

/**
 * Each notification type's `data` — ids and short values only (rdm-spec I-10). Each field comes
 * from the event that triggers the notification (api-endpoints-plan §10).
 */
export const NOTIFICATION_DATA = {
  [NotificationType.OWNER_REGISTRATION_APPROVED]: registrationDecision,
  [NotificationType.OWNER_REGISTRATION_REJECTED]: registrationDecision,
  [NotificationType.SUBMISSION_APPROVED]: submissionDecision,
  [NotificationType.SUBMISSION_REJECTED]: submissionDecision,
  [NotificationType.PLACE_ACTIVATED]: placeOnly,
  [NotificationType.PLACE_UNPUBLISHED]: z
    .object({ placeId: zUuidV7, reason: z.enum(PlaceInactiveReason) })
    .strict(),
  [NotificationType.SUBSCRIPTION_ACTIVATED]: z
    .object({ planCode: z.string().min(1).max(32) })
    .strict(),
  [NotificationType.SUBSCRIPTION_PAYMENT_FAILED]: z
    .object({ attemptCount: z.number().int().min(1), nextAttemptAt: zInstant.optional() })
    .strict(),
  [NotificationType.ENTITLEMENTS_REDUCED]: entitlementsReducedData,
  [NotificationType.VOUCHER_OFFER_APPROVED]: offerDecision,
  [NotificationType.VOUCHER_OFFER_REJECTED]: offerDecision,
  // No amount: staff never see sales, and the owner's console reads the order (api-endpoints-plan §5.7).
  [NotificationType.VOUCHER_SOLD]: z
    .object({
      orderId: zUuidV7,
      placeId: zUuidV7,
      quantity: z.number().int().min(1).max(MAX_VOUCHERS_PER_ORDER),
    })
    .strict(),
  [NotificationType.VOUCHER_CODE_GUESSING_SUSPECTED]: z
    .object({ billingAccountId: zUuidV7, windowEndsAt: zInstant })
    .strict(),
  [NotificationType.PAYOUT_ACCOUNT_ACTION_REQUIRED]: z
    .object({ requirementsDueCount: z.number().int().min(1) })
    .strict(),
  [NotificationType.ACCOUNT_RECOVERY_PENDING]: z
    .object({ recoveryId: zUuidV7, holdUntil: zInstant })
    .strict(),
  [NotificationType.ACCOUNT_RECOVERY_COMPLETED]: z.object({ recoveryId: zUuidV7 }).strict(),
  // Catalog publishes it on an admin edit of a Venue (api-endpoints-plan §3.5).
  [NotificationType.PLACE_EDITED_BY_ADMIN]: placeOnly,
  /** A language's narration failed for good; its text is still served (api-endpoints-plan §10). */
  [NotificationType.PLACE_NARRATION_FAILED]: z
    .object({ placeId: zUuidV7, lang: zLanguage })
    .strict(),
} as const satisfies Record<NotificationType, z.ZodType>;

/** One notification type's `data`. */
export type NotificationData<T extends NotificationType> = z.output<(typeof NOTIFICATION_DATA)[T]>;

/** A validated notification: its type, and that type's data. */
export type Notification = {
  [T in NotificationType]: { readonly type: T; readonly data: NotificationData<T> };
}[NotificationType];

function notificationVariant(type: NotificationType) {
  return z.object({ type: z.literal(type), data: NOTIFICATION_DATA[type] }).strict();
}

const [firstType, ...otherTypes] = Object.values(NotificationType);

/**
 * A notification as `notification.create` carries it. One discriminated union validates the type
 * and its data together, so data belonging to another type is refused.
 */
export const zNotification = z.discriminatedUnion('type', [
  notificationVariant(firstType as NotificationType),
  ...otherTypes.map(notificationVariant),
]) as unknown as z.ZodType<Notification>;
