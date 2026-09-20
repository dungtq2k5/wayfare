import { Metadata, status } from '@grpc/grpc-js';
import type { status as GrpcStatus } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import {
  ERROR_CODE_METADATA_KEY,
  ERROR_DETAILS_METADATA_KEY,
  errorDetailsSchema,
  ERRORS,
  HTTP_STATUS_METADATA_KEY,
} from '@wayfare/contracts';
import type { ErrorCode, ErrorDetails, GrpcStatusName } from '@wayfare/contracts';

/** A registry status name → the grpc-js status. */
export const GRPC_STATUS_BY_NAME: Readonly<Record<GrpcStatusName, GrpcStatus>> = {
  INVALID_ARGUMENT: status.INVALID_ARGUMENT,
  UNAUTHENTICATED: status.UNAUTHENTICATED,
  PERMISSION_DENIED: status.PERMISSION_DENIED,
  NOT_FOUND: status.NOT_FOUND,
  ALREADY_EXISTS: status.ALREADY_EXISTS,
  FAILED_PRECONDITION: status.FAILED_PRECONDITION,
  RESOURCE_EXHAUSTED: status.RESOURCE_EXHAUSTED,
  UNAVAILABLE: status.UNAVAILABLE,
  DEADLINE_EXCEEDED: status.DEADLINE_EXCEEDED,
  INTERNAL: status.INTERNAL,
};

/** The error object Nest hands to grpc-js — `metadata` must be a real `Metadata` to reach the wire. */
export interface RpcErrorObject {
  readonly code: GrpcStatus;
  readonly message: string;
  readonly details: string;
  readonly metadata: Metadata;
}

/** The details argument: required when the code has a schema, absent when it has none. */
export type RpcErrorDetailsArgs<C extends ErrorCode> =
  ErrorDetails<C> extends undefined ? [] : [details: ErrorDetails<C>];

/**
 * JSON with every non-ASCII character escaped. gRPC metadata values are ASCII only, and details
 * carry real text — a Vietnamese term, a name. `JSON.parse` reads the escapes back unchanged.
 */
function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u0080-\uffff]/g,
    // FIXME `String.raw` should be used to avoid escaping `\`.
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/**
 * The only way to throw across gRPC (conventions §6.4). Both statuses come from `ERRORS[code]`, so
 * one code never travels with two. Carries the code (`wf-error-code`), its HTTP status
 * (`wf-http-status`) and any details as JSON (`wf-error-details`) in trailing metadata. Details
 * that fail the code's schema are a bug in the thrower, and throw a plain `Error`.
 */
export function rpcError<C extends ErrorCode>(
  code: C,
  ...args: RpcErrorDetailsArgs<C>
): RpcException {
  const spec = ERRORS[code];
  const metadata = new Metadata();
  metadata.set(ERROR_CODE_METADATA_KEY, code);
  metadata.set(HTTP_STATUS_METADATA_KEY, String(spec.http));
  const [details] = args as unknown[];
  if (details !== undefined) {
    const parsed = errorDetailsSchema(code)?.safeParse(details);
    if (!parsed?.success) {
      throw new Error(`rpcError(${code}): details do not match the registered schema`, {
        cause: parsed?.error,
      });
    }
    metadata.set(ERROR_DETAILS_METADATA_KEY, asciiJson(parsed.data));
  }
  const error: RpcErrorObject = {
    code: GRPC_STATUS_BY_NAME[spec.grpc],
    message: code,
    details: code,
    metadata,
  };
  return new RpcException(error);
}
