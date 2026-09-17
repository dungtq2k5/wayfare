import { Metadata, status } from '@grpc/grpc-js';
import type { status as GrpcStatus, ServiceError } from '@grpc/grpc-js';
import {
  ERROR_CODE_METADATA_KEY,
  ERROR_DETAILS_METADATA_KEY,
  ERRORS,
  HTTP_STATUS_METADATA_KEY,
  isErrorCode,
  isErrorHttpStatus,
} from '@wayfare/contracts';

/**
 * True for a failed grpc-js call. On the client side a rejected `ClientGrpc` call is a plain
 * `ServiceError`, never an `RpcException`, so it is recognized by shape.
 */
export function isGrpcServiceError(error: unknown): error is ServiceError {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as Partial<ServiceError>;
  return typeof candidate.code === 'number' && candidate.metadata instanceof Metadata;
}

/** gRPC status → HTTP status (conventions §6.4), for an error whose code does not decide it. */
export const GRPC_TO_HTTP_STATUS: Readonly<Partial<Record<GrpcStatus, number>>> = {
  [status.INVALID_ARGUMENT]: 400,
  [status.UNAUTHENTICATED]: 401,
  [status.PERMISSION_DENIED]: 403,
  [status.NOT_FOUND]: 404,
  [status.ALREADY_EXISTS]: 409,
  [status.FAILED_PRECONDITION]: 409,
  [status.RESOURCE_EXHAUSTED]: 429,
  [status.UNAVAILABLE]: 503,
  [status.DEADLINE_EXCEEDED]: 504,
};

/** The Wayfare error a `ServiceError` carries in its trailing metadata. */
export interface GrpcErrorInfo {
  /** An `ErrorCode` — or, from a peer deployed first, a code this build does not know. */
  readonly code: string;
  readonly httpStatus: number;
  /** False when the code is missing from this build's registry. */
  readonly known: boolean;
  readonly details: Record<string, unknown> | null;
}

/**
 * Reads `wf-error-code`, `wf-http-status` and `wf-error-details`; null when there is no code. The
 * status is decided in this order (conventions §6.4):
 *
 * 1. a code this build knows answers its registered status — the header is ignored, so a peer
 *    cannot choose a status for it;
 * 2. an unknown code answers the header's status when it is a legal one, else the gRPC mapping,
 *    else 500 — and keeps its code;
 * 3. no code at all is the caller's case to handle.
 */
export function readGrpcErrorInfo(error: ServiceError): GrpcErrorInfo | null {
  const first = (key: string): string | null => {
    const value = error.metadata.get(key)[0];
    return typeof value === 'string' ? value : null;
  };
  const code = first(ERROR_CODE_METADATA_KEY);
  if (code === null) return null;
  const details = parseDetails(first(ERROR_DETAILS_METADATA_KEY));
  if (isErrorCode(code)) {
    return { code, httpStatus: ERRORS[code].http, known: true, details };
  }
  const header = Number(first(HTTP_STATUS_METADATA_KEY));
  const httpStatus = isErrorHttpStatus(header) ? header : (GRPC_TO_HTTP_STATUS[error.code] ?? 500);
  return { code, httpStatus, known: false, details };
}

function parseDetails(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // Malformed details are dropped: the code alone is still a complete answer.
    return null;
  }
}
