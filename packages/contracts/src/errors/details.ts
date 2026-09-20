import { z } from 'zod';
import { VoucherStatus } from '../billing/enums';
import { SUBMISSION_EDITABLE_FIELDS } from '../catalog/submission-fields';
import { zUuidV7 } from '../common/ids';
import { LegalDocument } from '../identity/enums';
import { zMoney } from '../money/money';

const zInstant = z.iso.datetime({ offset: true });

/** One failed field: where, and which rule (api-endpoints-plan §0.4). Never the rejected value. */
export const zValidationIssue = z.object({ path: z.string(), code: z.string() }).strict();

/** `VALIDATION_FAILED`. */
export const validationFailedDetails = z
  .object({ issues: z.array(zValidationIssue).min(1) })
  .strict();

/** `PERMISSION_DENIED`: the codes the route requires. */
export const permissionDeniedDetails = z.object({ required: z.array(z.string()).min(1) }).strict();

/** `RESOURCE_NOT_FOUND`: an `AuditResourceType` value, or another upper-snake noun. */
export const resourceNotFoundDetails = z
  .object({ resource: z.string().regex(/^[A-Z][A-Z0-9_]*$/) })
  .strict();

/** `INVALID_STATE`: the resource's current status. */
export const invalidStateDetails = z.object({ status: z.string().min(1) }).strict();

/** `PAYOUT_CHANGES_COOLING_DOWN`: when changes are allowed again. */
export const coolingDownDetails = z.object({ until: zInstant }).strict();

/** The `*_LIMIT_REACHED` and `BOOST_SLOTS_EXCEEDED` codes: the effective limit. */
export const limitDetails = z.object({ limit: z.number().int().min(0) }).strict();

/** `VOUCHER_NOT_REDEEMABLE`: why. */
export const voucherNotRedeemableDetails = z
  .object({ status: z.enum(VoucherStatus), redeemedAt: zInstant.optional() })
  .strict();

/** `PRICE_BELOW_MINIMUM`: the minimum. */
export const priceBelowMinimumDetails = z.object({ minimum: zMoney }).strict();

/** `APP_VERSION_UNSUPPORTED`: the oldest version the gateway accepts. */
export const appVersionUnsupportedDetails = z
  .object({ minimumVersion: z.string().min(1) })
  .strict();

/** `RATE_LIMITED`, `SHORT_CODE_ENTRY_PAUSED`: seconds until the window reopens. */
export const retryAfterDetails = z.object({ retryAfterSeconds: z.number().int().min(0) }).strict();

/** `AI_QUOTA_EXHAUSTED`: when the daily quota resets. */
export const quotaExhaustedDetails = z.object({ resetsAt: zInstant }).strict();

/** `LEGAL_VERSION_OUTDATED`: which document, and its current version. */
export const legalVersionOutdatedDetails = z
  .object({ document: z.enum(LegalDocument), currentVersion: z.string().min(1) })
  .strict();

/** `OWNER_HAS_LIVE_VOUCHERS`: what billing still owes buyers (api-endpoints-plan §1.6). */
export const ownerHasLiveVouchersDetails = z
  .object({
    issuedVoucherCount: z.number().int().min(0),
    openCheckoutCount: z.number().int().min(0),
  })
  .strict();

/** `OWNER_HAS_ACTIVE_OBLIGATIONS`: when a cancelled subscription's paid period ends, if known. */
export const ownerHasActiveObligationsDetails = z
  .object({ subscriptionEndsAt: zInstant.optional() })
  .strict();

/**
 * `SUBMISSION_CONFLICT`: the owner-editable fields someone else changed since the submission's
 * base — empty when a stale base is refused at submission, where the owner simply reloads.
 */
export const submissionConflictDetails = z
  .object({ changedFields: z.array(z.enum(SUBMISSION_EDITABLE_FIELDS)) })
  .strict();

/** `ROLE_IN_USE`: how many accounts, deactivated ones included, still hold the role. */
export const roleInUseDetails = z.object({ holders: z.number().int().min(1) }).strict();

/** `ROLE_TOO_WIDE_TO_EDIT`: the role's live holders, and the most one change may touch. */
export const roleTooWideDetails = z
  .object({ holders: z.number().int().min(0), limit: z.number().int().min(0) })
  .strict();

/** `PERMISSION_RETIRED`: the retired codes the request named, sorted. */
export const permissionRetiredDetails = z
  .object({ codes: z.array(z.string().min(1)).min(1) })
  .strict();

/** `AREA_OVERLAPS`: the codes of the active areas the boundary intersects, sorted. */
export const areaOverlapsDetails = z.object({ codes: z.array(z.string().min(1)).min(1) }).strict();

/** `AREA_EXCLUDES_PLACES`: how many Places the boundary would leave outside, and the first ids. */
export const areaExcludesPlacesDetails = z
  .object({ count: z.number().int().min(1), placeIds: z.array(zUuidV7).min(1).max(20) })
  .strict();

/** `AREA_HAS_LIVE_PLACES`: how many `PROCESSING` or `ACTIVE` Places the area still holds. */
export const areaHasLivePlacesDetails = z.object({ count: z.number().int().min(1) }).strict();

/** `MAP_PACK_HASH_MISMATCH`, `MAP_PACK_OBJECT_MISSING`: the object at fault. */
export const mapPackObjectDetails = z.object({ path: z.string().min(1) }).strict();

/** `MAP_PACK_TOO_LARGE`: the pack's weight and the budget. */
export const mapPackTooLargeDetails = z
  .object({ bytes: z.number().int().min(1), maxBytes: z.number().int().min(1) })
  .strict();
