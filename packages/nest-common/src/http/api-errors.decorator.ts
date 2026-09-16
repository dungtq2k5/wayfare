import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import type { ErrorCode } from '@wayfare/contracts';

/** The HTTP status each error code is answered with — used only to document routes. */
export const ERROR_CODE_HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  CLIENT_HEADER_REQUIRED: 400,
  MALFORMED_REQUEST: 400,
  ROUTE_NOT_FOUND: 404,
  UPSTREAM_UNAVAILABLE: 503,
  UPSTREAM_TIMEOUT: 504,
  INTERNAL: 500,
};

const ERROR_ENVELOPE_SCHEMA = (codes: readonly ErrorCode[]) => ({
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message', 'requestId'],
      properties: {
        code: { type: 'string', enum: [...codes] },
        message: { type: 'string' },
        details: { type: 'object', additionalProperties: true },
        requestId: { type: 'string' },
      },
    },
  },
});

/**
 * Declares every error code a route can return, grouped by status, with the error envelope
 * schema (conventions §5.7). An undeclared code is a client that cannot explain the failure.
 */
export function ApiErrors(
  ...codes: [ErrorCode, ...ErrorCode[]]
): ReturnType<typeof applyDecorators> {
  const byStatus = new Map<number, ErrorCode[]>();
  for (const code of codes) {
    const status = ERROR_CODE_HTTP_STATUS[code];
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }
  return applyDecorators(
    ...[...byStatus].map(([status, grouped]) =>
      ApiResponse({
        status,
        description: grouped.join(' | '),
        schema: ERROR_ENVELOPE_SCHEMA(grouped),
      }),
    ),
  );
}
