import { applyDecorators } from '@nestjs/common';
import type { ErrorCode } from '@wayfare/contracts';
import { DocumentedRoute, setApiErrorCodes } from './route-docs';

/**
 * Declares the error codes a route can return beyond the automatic ones (conventions §5.7). The
 * post-pass in `setupSwagger` adds `INTERNAL`, `CLIENT_HEADER_REQUIRED`, `RATE_LIMITED`,
 * `VALIDATION_FAILED`, the upstream codes and the marker's codes, groups everything by its
 * registered status, and writes the error envelope schema. Naming an automatic code is harmless.
 */
export function ApiErrors(...codes: [ErrorCode, ...ErrorCode[]]): MethodDecorator {
  return applyDecorators(setApiErrorCodes(codes), DocumentedRoute());
}
