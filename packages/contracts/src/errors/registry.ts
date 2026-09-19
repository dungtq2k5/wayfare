import type { z } from 'zod';
import {
  appVersionUnsupportedDetails,
  coolingDownDetails,
  invalidStateDetails,
  legalVersionOutdatedDetails,
  limitDetails,
  ownerHasLiveVouchersDetails,
  permissionDeniedDetails,
  permissionRetiredDetails,
  priceBelowMinimumDetails,
  quotaExhaustedDetails,
  resourceNotFoundDetails,
  retryAfterDetails,
  roleInUseDetails,
  roleTooWideDetails,
  validationFailedDetails,
  voucherNotRedeemableDetails,
} from './details';

/** The gRPC status names a code may use — strings, so contracts needs no grpc-js import. */
export type GrpcStatusName =
  | 'INVALID_ARGUMENT'
  | 'UNAUTHENTICATED'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'FAILED_PRECONDITION'
  | 'RESOURCE_EXHAUSTED'
  | 'UNAVAILABLE'
  | 'DEADLINE_EXCEEDED'
  | 'INTERNAL';

/** Every HTTP status an error code may answer (api-endpoints-plan §0.4). */
export const ERROR_HTTP_STATUSES = [
  400, 401, 403, 404, 409, 410, 422, 426, 429, 500, 502, 503, 504,
] as const;

/** An HTTP status an error code may answer. */
export type ErrorHttpStatus = (typeof ERROR_HTTP_STATUSES)[number];

/** True when `value` is an HTTP status an error code may answer. */
export function isErrorHttpStatus(value: unknown): value is ErrorHttpStatus {
  return typeof value === 'number' && (ERROR_HTTP_STATUSES as readonly number[]).includes(value);
}

/** One error code's contract (api-endpoints-plan §0.4, conventions §6.4). */
export interface ErrorSpec {
  readonly http: ErrorHttpStatus;
  readonly grpc: GrpcStatusName;
  /** The shape of `details`, when the code has one. A code without a schema sends no details. */
  readonly details?: z.ZodType;
}

const badRequest = { http: 400, grpc: 'INVALID_ARGUMENT' } as const;
const unauthenticated = { http: 401, grpc: 'UNAUTHENTICATED' } as const;
const forbidden = { http: 403, grpc: 'PERMISSION_DENIED' } as const;
const notFound = { http: 404, grpc: 'NOT_FOUND' } as const;
const exists = { http: 409, grpc: 'ALREADY_EXISTS' } as const;
const conflict = { http: 409, grpc: 'FAILED_PRECONDITION' } as const;
const gone = { http: 410, grpc: 'FAILED_PRECONDITION' } as const;
const unprocessable = { http: 422, grpc: 'FAILED_PRECONDITION' } as const;
const tooMany = { http: 429, grpc: 'RESOURCE_EXHAUSTED' } as const;
const unavailable = { http: 503, grpc: 'UNAVAILABLE' } as const;
const timeout = { http: 504, grpc: 'DEADLINE_EXCEEDED' } as const;

/**
 * Every error code a client can receive, with its statuses (api-endpoints-plan §0.4). A code not
 * here does not exist; one code never answers two statuses.
 */
export const ERRORS = {
  // Every edge.
  VALIDATION_FAILED: { ...badRequest, details: validationFailedDetails },
  MALFORMED_REQUEST: badRequest,
  CLIENT_HEADER_REQUIRED: badRequest,
  IDEMPOTENCY_KEY_REQUIRED: badRequest,

  // 401
  UNAUTHENTICATED: unauthenticated,
  INVALID_CREDENTIALS: unauthenticated,
  DEVICE_REVOKED: unauthenticated,

  // 403
  PERMISSION_DENIED: { ...forbidden, details: permissionDeniedDetails },
  ACCOUNT_LOCKED: forbidden,
  CURRENT_PASSWORD_INCORRECT: forbidden,
  INVITATION_EMAIL_MISMATCH: forbidden,
  RECOVERY_SELF_APPROVAL: forbidden,
  EMAIL_NOT_VERIFIED: forbidden,
  CONSENT_REQUIRED: forbidden,
  ANALYTICS_LEVEL_INSUFFICIENT: forbidden,
  SUPER_ADMIN_NOT_ASSIGNABLE: forbidden,
  SELF_ACTION_FORBIDDEN: forbidden,
  SYSTEM_ROLE_READ_ONLY: forbidden,

  // 404 — one not-found code; `details.resource` says which.
  ROUTE_NOT_FOUND: notFound,
  RESOURCE_NOT_FOUND: { ...notFound, details: resourceNotFoundDetails },
  PLACE_UNAVAILABLE: notFound,
  LOCALIZATION_TARGET_UNAVAILABLE: notFound,

  // 409
  EMAIL_TAKEN: exists,
  SHORT_CODE_COLLISION: exists,
  SUBSCRIPTION_EXISTS: exists,
  REGISTRATION_ALREADY_PENDING: exists,
  ROLE_NAME_TAKEN: exists,
  INVALID_STATE: { ...conflict, details: invalidStateDetails },
  EMAIL_CHANGE_REVERT_PENDING: conflict,
  IDEMPOTENCY_KEY_IN_FLIGHT: conflict,
  PAYOUT_CHANGES_COOLING_DOWN: { ...conflict, details: coolingDownDetails },
  BUYER_HAS_PENDING_ORDER: conflict,
  OWNER_HAS_ACTIVE_OBLIGATIONS: conflict,
  OWNER_HAS_LIVE_VOUCHERS: { ...conflict, details: ownerHasLiveVouchersDetails },
  ROLE_IN_USE: { ...conflict, details: roleInUseDetails },
  LAST_SUPER_ADMIN: conflict,
  ROLE_TOO_WIDE_TO_EDIT: { ...conflict, details: roleTooWideDetails },
  PLACE_LIMIT_REACHED: { ...conflict, details: limitDetails },
  PHOTO_LIMIT_REACHED: { ...conflict, details: limitDetails },
  MENU_LIMIT_REACHED: { ...conflict, details: limitDetails },
  STAFF_LIMIT_REACHED: { ...conflict, details: limitDetails },
  BOOST_SLOTS_EXCEEDED: { ...conflict, details: limitDetails },
  SUBMISSION_CONFLICT: conflict,
  PLACE_HAS_LIVE_VOUCHERS: conflict,
  PLACE_IN_ACTIVE_TOUR: conflict,
  UPLOAD_NOT_READY: conflict,
  SYNTHESIS_JOB_NOT_ACTIVE: conflict,
  DIFF_UNAVAILABLE: conflict,
  LANGUAGE_NOT_ENTITLED: conflict,
  LOCALIZATION_SOURCE_CHANGED: conflict,
  NO_STRIPE_CUSTOMER: conflict,
  VOUCHERS_NOT_ENTITLED: conflict,
  PAYOUT_ACCOUNT_NOT_READY: conflict,
  VOUCHER_NOT_REDEEMABLE: { ...conflict, details: voucherNotRedeemableDetails },
  OUT_OF_STOCK: conflict,
  SELLER_NOT_READY: conflict,
  PLAN_HAS_SUBSCRIBERS: conflict,
  TRANSLATION_NOT_READY: conflict,
  LEGAL_VERSION_OUTDATED: { ...conflict, details: legalVersionOutdatedDetails },

  // 410 — every single-use link, spent or expired; a national ID after its redaction.
  TOKEN_EXPIRED: gone,
  NATIONAL_ID_REDACTED: gone,

  // 422
  IDEMPOTENCY_KEY_REUSED: unprocessable,
  LOCATION_OUTSIDE_AREAS: unprocessable,
  CATEGORY_NOT_APPLICABLE: unprocessable,
  UPLOAD_TOO_LARGE: unprocessable,
  UPLOAD_TYPE_MISMATCH: unprocessable,
  PRICE_BELOW_MINIMUM: { ...unprocessable, details: priceBelowMinimumDetails },
  RECOVERY_EVIDENCE_INSUFFICIENT: unprocessable,
  PERMISSION_RETIRED: { ...unprocessable, details: permissionRetiredDetails },

  // 426
  APP_VERSION_UNSUPPORTED: {
    http: 426,
    grpc: 'FAILED_PRECONDITION',
    details: appVersionUnsupportedDetails,
  },

  // 429 — the gateway also sets `Retry-After`.
  RATE_LIMITED: { ...tooMany, details: retryAfterDetails },
  SHORT_CODE_ENTRY_PAUSED: { ...tooMany, details: retryAfterDetails },
  AI_QUOTA_EXHAUSTED: { ...tooMany, details: quotaExhaustedDetails },

  // 5xx
  INTERNAL: { http: 500, grpc: 'INTERNAL' },
  AI_OUTPUT_REJECTED: { http: 502, grpc: 'INTERNAL' },
  UPSTREAM_UNAVAILABLE: unavailable,
  ENTITLEMENTS_UNAVAILABLE: unavailable,
  UPSTREAM_TIMEOUT: timeout,
  AI_TIMEOUT: timeout,
} as const satisfies Record<string, ErrorSpec>;

/** A machine-readable error condition, `SCREAMING_SNAKE`. */
export type ErrorCode = keyof typeof ERRORS;

/** Every error code, in registry order. */
export const ERROR_CODES = Object.keys(ERRORS) as ErrorCode[];

/** The `details` type of one code — `undefined` when it has none. */
export type ErrorDetails<C extends ErrorCode> = (typeof ERRORS)[C] extends {
  readonly details: infer S extends z.ZodType;
}
  ? z.input<S>
  : undefined;

/** True when `value` is a known `ErrorCode`. */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERRORS, value);
}

/** The details schema of a code, if it has one. */
export function errorDetailsSchema(code: ErrorCode): z.ZodType | undefined {
  const spec: ErrorSpec = ERRORS[code];
  return spec.details;
}

/** Trailing-metadata key carrying the `ErrorCode` across gRPC (conventions §6.4). */
export const ERROR_CODE_METADATA_KEY = 'wf-error-code';

/**
 * Trailing-metadata key carrying the code's HTTP status. The gateway reads it only for a code its
 * own registry lacks — a service deployed with a new code before the gateway.
 */
export const HTTP_STATUS_METADATA_KEY = 'wf-http-status';

/** Trailing-metadata key carrying the JSON-encoded `details` (conventions §6.4). */
export const ERROR_DETAILS_METADATA_KEY = 'wf-error-details';
