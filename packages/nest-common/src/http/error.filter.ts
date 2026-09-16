import { status as GrpcStatus } from '@grpc/grpc-js';
import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { isGrpcServiceError, readGrpcErrorInfo } from '../errors/grpc-service-error';
import { requestIdOfActiveTrace } from '../observability/trace';
import { AppHttpException } from './app-http.exception';

/** The error envelope (api-endpoints-plan §0.4). */
export interface ErrorBody {
  error: {
    /** An `ErrorCode` — or, from a peer, a code this build may not know yet. */
    code: string;
    message: string;
    details?: Record<string, unknown>;
    requestId: string;
  };
}

/** gRPC status → HTTP status (conventions §6.4). `wf-http-status` overrides it per error. */
export const GRPC_TO_HTTP_STATUS: Readonly<Partial<Record<GrpcStatus, number>>> = {
  [GrpcStatus.INVALID_ARGUMENT]: HttpStatus.BAD_REQUEST,
  [GrpcStatus.UNAUTHENTICATED]: HttpStatus.UNAUTHORIZED,
  [GrpcStatus.PERMISSION_DENIED]: HttpStatus.FORBIDDEN,
  [GrpcStatus.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [GrpcStatus.ALREADY_EXISTS]: HttpStatus.CONFLICT,
  [GrpcStatus.FAILED_PRECONDITION]: HttpStatus.CONFLICT,
  [GrpcStatus.RESOURCE_EXHAUSTED]: HttpStatus.TOO_MANY_REQUESTS,
  [GrpcStatus.UNAVAILABLE]: HttpStatus.SERVICE_UNAVAILABLE,
  [GrpcStatus.DEADLINE_EXCEEDED]: HttpStatus.GATEWAY_TIMEOUT,
};

/** `Retry-After` seconds sent with a `503`. */
export const RETRY_AFTER_SECONDS = 5;

// Plain numbers: HTTP statuses arrive as numbers, and comparing them to the enum is unsafe.
const FORBIDDEN: number = HttpStatus.FORBIDDEN;
const NOT_FOUND: number = HttpStatus.NOT_FOUND;
const TOO_MANY_REQUESTS: number = HttpStatus.TOO_MANY_REQUESTS;
const SERVICE_UNAVAILABLE: number = HttpStatus.SERVICE_UNAVAILABLE;

interface Resolved {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  log?: unknown;
}

/**
 * Builds `{ error: { code, message, details?, requestId } }` for every failure — the gateway half
 * of `rpcError` (conventions §5.1, §6.4). In production, `5xx` and `403` messages are generic.
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorFilter.name);

  constructor(private readonly isProduction: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;
    const response = host.switchToHttp().getResponse<Response>();
    const resolved = resolve(exception);

    if (resolved.status >= 500) {
      this.logger.error({ err: resolved.log ?? exception, code: resolved.code }, 'request failed');
    }
    if (resolved.status === SERVICE_UNAVAILABLE || resolved.status === TOO_MANY_REQUESTS) {
      response.setHeader('Retry-After', String(RETRY_AFTER_SECONDS));
    }
    const generic = this.isProduction && (resolved.status >= 500 || resolved.status === FORBIDDEN);
    const body: ErrorBody = {
      error: {
        code: resolved.code,
        message: generic ? genericMessage(resolved.status) : resolved.message,
        ...(resolved.details === undefined ? {} : { details: resolved.details }),
        requestId: requestIdOfActiveTrace(),
      },
    };
    response.status(resolved.status).json(body);
  }
}

function resolve(exception: unknown): Resolved {
  if (exception instanceof ZodValidationException) {
    const error = exception.getZodError() as
      { issues?: { path: PropertyKey[]; code: string }[] } | undefined;
    const issues = (error?.issues ?? []).map((issue) => ({
      path: toJsonPointer(issue.path),
      code: issue.code,
    }));
    return {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_FAILED',
      message: 'Validation failed',
      details: { issues },
    };
  }
  if (exception instanceof AppHttpException) {
    return {
      status: exception.getStatus(),
      code: exception.code,
      message: exception.message,
      ...(exception.details === undefined ? {} : { details: exception.details }),
    };
  }
  if (isGrpcServiceError(exception)) {
    const info = readGrpcErrorInfo(exception);
    if (info.errorCode !== null) {
      return {
        status:
          info.httpStatus ??
          GRPC_TO_HTTP_STATUS[exception.code] ??
          HttpStatus.INTERNAL_SERVER_ERROR,
        code: info.errorCode,
        message: info.errorCode,
        ...(info.details === null ? {} : { details: info.details }),
      };
    }
    if (exception.code === GrpcStatus.UNAVAILABLE) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        code: 'UPSTREAM_UNAVAILABLE',
        message: 'A required service is unavailable',
        log: exception,
      };
    }
    if (exception.code === GrpcStatus.DEADLINE_EXCEEDED) {
      return {
        status: HttpStatus.GATEWAY_TIMEOUT,
        code: 'UPSTREAM_TIMEOUT',
        message: 'A required service did not answer in time',
        log: exception,
      };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL',
      message: 'Upstream error without an error code',
      log: exception,
    };
  }
  if (exception instanceof HttpException) {
    // Framework-raised errors: an unmatched route, a malformed JSON body, an oversized payload.
    const status = exception.getStatus();
    if (status === NOT_FOUND) {
      return { status, code: 'ROUTE_NOT_FOUND', message: 'No such route' };
    }
    if (status < 500) {
      return { status, code: 'MALFORMED_REQUEST', message: exception.message };
    }
    return { status, code: 'INTERNAL', message: exception.message, log: exception };
  }
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: 'INTERNAL',
    message: 'Internal error',
    log: exception,
  };
}

/** RFC 6901 JSON pointer for a zod issue path. */
export function toJsonPointer(path: readonly PropertyKey[]): string {
  return path
    .map((segment) => `/${String(segment).replaceAll('~', '~0').replaceAll('/', '~1')}`)
    .join('');
}

function genericMessage(status: number): string {
  return status === FORBIDDEN ? 'Forbidden' : 'Something went wrong';
}
