import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { ERRORS } from '@wayfare/contracts';
import type { ErrorCode } from '@wayfare/contracts';

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
 * schema (conventions §5.7). Each code's status is its registered one. An undeclared code is a client that cannot explain the failure.
 */
export function ApiErrors(
  ...codes: [ErrorCode, ...ErrorCode[]]
): ReturnType<typeof applyDecorators> {
  const byStatus = new Map<number, ErrorCode[]>();
  for (const code of codes) {
    const status = ERRORS[code].http;
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
