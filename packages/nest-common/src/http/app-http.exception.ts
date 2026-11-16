import { HttpException } from '@nestjs/common';
import { ERRORS } from '@wayfare/contracts';
import type { ErrorCode } from '@wayfare/contracts';
import type { RpcErrorDetailsArgs } from '../errors/rpc-error';

class AppHttpExceptionImpl extends HttpException {
  readonly details?: Record<string, unknown>;

  constructor(
    readonly code: ErrorCode,
    details?: Record<string, unknown>,
  ) {
    super(code, ERRORS[code].http);
    if (details !== undefined) this.details = details;
  }
}

/** The constructor's public shape: details typed per code, as `rpcError` takes them. */
interface AppHttpExceptionConstructor {
  new <C extends ErrorCode>(code: C, ...details: RpcErrorDetailsArgs<C>): AppHttpExceptionImpl;
  readonly prototype: AppHttpExceptionImpl;
}

/**
 * An HTTP error raised at the gateway, carrying its `ErrorCode` for the error filter. Like
 * `rpcError`, the status comes from the registry.
 */
export type AppHttpException = AppHttpExceptionImpl;
export const AppHttpException = AppHttpExceptionImpl as AppHttpExceptionConstructor;

/** A stored `4xx`, replayed through the error filter exactly as it was first answered. */
export class ReplayedHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: Record<string, unknown> | undefined,
  ) {
    super(code);
    this.name = 'ReplayedHttpError';
  }
}
