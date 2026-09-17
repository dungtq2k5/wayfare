import { z } from 'zod';
import { VoucherStatus } from '../billing/enums';
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
