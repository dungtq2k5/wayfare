import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  ERRORS,
  errorDetailsSchema,
  isErrorCode,
  isErrorHttpStatus,
} from './registry';
import type { ErrorDetails } from './registry';
import { expectTypeOf } from 'vitest';

// conventions §6.4: the gRPC status each HTTP status travels as.
const GRPC_FOR_HTTP: Record<number, readonly string[]> = {
  400: ['INVALID_ARGUMENT'],
  401: ['UNAUTHENTICATED'],
  403: ['PERMISSION_DENIED'],
  404: ['NOT_FOUND'],
  409: ['FAILED_PRECONDITION', 'ALREADY_EXISTS'],
  410: ['FAILED_PRECONDITION'],
  422: ['FAILED_PRECONDITION'],
  426: ['FAILED_PRECONDITION'],
  429: ['RESOURCE_EXHAUSTED'],
  500: ['INTERNAL'],
  502: ['INTERNAL'],
  503: ['UNAVAILABLE'],
  504: ['DEADLINE_EXCEEDED'],
};

describe('errors registry', () => {
  it.each(ERROR_CODES)('%s pairs its statuses by the convention', (code) => {
    const spec = ERRORS[code];
    expect(code).toMatch(/^[A-Z][A-Z0-9_]*$/);
    expect(GRPC_FOR_HTTP[spec.http]).toContain(spec.grpc);
  });

  it('knows its own codes and statuses', () => {
    expect(isErrorCode('RESOURCE_NOT_FOUND')).toBe(true);
    expect(isErrorCode('PLACE_NOT_FOUND')).toBe(false);
    expect(isErrorCode('toString')).toBe(false);
    expect(isErrorHttpStatus(426)).toBe(true);
    expect(isErrorHttpStatus(418)).toBe(false);
  });

  it('types details per code', () => {
    expectTypeOf<ErrorDetails<'INTERNAL'>>().toEqualTypeOf<undefined>();
    expectTypeOf<ErrorDetails<'RATE_LIMITED'>>().toEqualTypeOf<{ retryAfterSeconds: number }>();
    expect(errorDetailsSchema('INTERNAL')).toBeUndefined();
    expect(errorDetailsSchema('RESOURCE_NOT_FOUND')?.safeParse({ resource: 'PLACE' }).success).toBe(
      true,
    );
    expect(errorDetailsSchema('RESOURCE_NOT_FOUND')?.safeParse({ resource: 'place' }).success).toBe(
      false,
    );
  });
});
