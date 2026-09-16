import { HttpException } from '@nestjs/common';
import type { ErrorCode } from '@wayfare/contracts';

/** An HTTP error raised at the gateway, carrying its `ErrorCode` for the error filter. */
export class AppHttpException extends HttpException {
  constructor(
    status: number,
    readonly code: ErrorCode,
    readonly details?: Record<string, unknown>,
    message: string = code,
  ) {
    super(message, status);
  }
}
