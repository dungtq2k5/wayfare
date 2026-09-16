/** Every error code a client can receive — the contract clients translate (api-endpoints-plan §0.4). */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'MALFORMED_REQUEST',
  'CLIENT_HEADER_REQUIRED',
  'ROUTE_NOT_FOUND',
  'UPSTREAM_UNAVAILABLE',
  'UPSTREAM_TIMEOUT',
  'INTERNAL',
] as const;

/** A machine-readable error condition, `SCREAMING_SNAKE`. */
export type ErrorCode = (typeof ERROR_CODES)[number];

/** True when `value` is a known `ErrorCode`. */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

/** Trailing-metadata key carrying the `ErrorCode` across gRPC (conventions §6.4). */
export const ERROR_CODE_METADATA_KEY = 'wf-error-code';

/** Trailing-metadata key overriding the default HTTP status for a gRPC status. */
export const HTTP_STATUS_METADATA_KEY = 'wf-http-status';
