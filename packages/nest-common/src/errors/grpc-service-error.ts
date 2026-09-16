import { Metadata } from '@grpc/grpc-js';
import type { ServiceError } from '@grpc/grpc-js';
import { ERROR_CODE_METADATA_KEY, HTTP_STATUS_METADATA_KEY } from '@wayfare/contracts';
import { ERROR_DETAILS_METADATA_KEY } from './rpc-error';

/**
 * True for a failed grpc-js call. On the client side a rejected `ClientGrpc` call is a plain
 * `ServiceError`, never an `RpcException`, so it is recognized by shape.
 */
export function isGrpcServiceError(error: unknown): error is ServiceError {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as Partial<ServiceError>;
  return typeof candidate.code === 'number' && candidate.metadata instanceof Metadata;
}

/** The Wayfare error fields carried in a `ServiceError`'s trailing metadata. */
export interface GrpcErrorInfo {
  readonly errorCode: string | null;
  readonly httpStatus: number | null;
  readonly details: Record<string, unknown> | null;
}

/** Reads `wf-error-code`, `wf-http-status` and `wf-error-details` from a `ServiceError`. */
export function readGrpcErrorInfo(error: ServiceError): GrpcErrorInfo {
  const first = (key: string): string | null => {
    const value = error.metadata.get(key)[0];
    return typeof value === 'string' ? value : null;
  };
  const http = first(HTTP_STATUS_METADATA_KEY);
  const rawDetails = first(ERROR_DETAILS_METADATA_KEY);
  let details: Record<string, unknown> | null = null;
  if (rawDetails !== null) {
    try {
      details = JSON.parse(rawDetails) as Record<string, unknown>;
    } catch {
      // Malformed details are dropped: the code alone is still a complete answer.
      details = null;
    }
  }
  return {
    errorCode: first(ERROR_CODE_METADATA_KEY),
    httpStatus: http === null ? null : Number(http),
    details,
  };
}
