import { Metadata } from '@grpc/grpc-js';
import type { status as GrpcStatus } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { ERROR_CODE_METADATA_KEY, HTTP_STATUS_METADATA_KEY } from '@wayfare/contracts';

/** Trailing-metadata key carrying an error's `details` as JSON. */
export const ERROR_DETAILS_METADATA_KEY = 'wf-error-details';

/** Options for `rpcError`. */
export interface RpcErrorOptions {
  /** Overrides the gateway's default HTTP status for this gRPC status (e.g. 410, 422). */
  readonly http?: number;
}

/** The error object Nest hands to grpc-js — `metadata` must be a real `Metadata` to reach the wire. */
export interface RpcErrorObject {
  readonly code: GrpcStatus;
  readonly message: string;
  readonly details: string;
  readonly metadata: Metadata;
}

/**
 * The only way to throw across gRPC (conventions §6.4). Carries the `ErrorCode` as trailing
 * metadata (`wf-error-code`), plus `wf-http-status` when `opts.http` is set, and `details`
 * as JSON in `wf-error-details`.
 */
export function rpcError(
  code: GrpcStatus,
  errorCode: string,
  details?: Record<string, unknown>,
  opts: RpcErrorOptions = {},
): RpcException {
  const metadata = new Metadata();
  metadata.set(ERROR_CODE_METADATA_KEY, errorCode);
  if (opts.http !== undefined) metadata.set(HTTP_STATUS_METADATA_KEY, String(opts.http));
  if (details !== undefined) metadata.set(ERROR_DETAILS_METADATA_KEY, JSON.stringify(details));
  const error: RpcErrorObject = { code, message: errorCode, details: errorCode, metadata };
  return new RpcException(error);
}
