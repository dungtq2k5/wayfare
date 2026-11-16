import { Metadata, status } from '@grpc/grpc-js';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppHttpException } from './app-http.exception';
import { ErrorFilter, toJsonPointer } from './error.filter';
import type { ErrorBody } from './error.filter';

interface FakeResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: ErrorBody | undefined;
}

function run(exception: unknown, isProduction = false): FakeResponse {
  const response = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as ErrorBody | undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: ErrorBody) {
      this.body = body;
      return this;
    },
    setHeader(key: string, value: string) {
      this.headers[key] = value;
    },
  };
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  new ErrorFilter(isProduction).catch(exception, host);
  return response;
}

function grpcError(code: status, entries: Record<string, string> = {}): Error {
  const metadata = new Metadata();
  for (const [key, value] of Object.entries(entries)) metadata.set(key, value);
  return Object.assign(new Error('grpc'), { code, details: 'x', metadata });
}

describe('ErrorFilter mapping', () => {
  it('maps a zod failure to 400 VALIDATION_FAILED with JSON-pointer issues', () => {
    const result = z.object({ a: z.object({ b: z.string() }) }).safeParse({ a: { b: 1 } });
    const res = run(new ZodValidationException(result.error));
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { issues: [{ path: '/a/b', code: 'invalid_type' }] },
    });
  });

  it('maps an AppHttpException to its registered status and code', () => {
    const res = run(new AppHttpException('CLIENT_HEADER_REQUIRED'));
    expect(res.statusCode).toBe(400);
    expect(res.body?.error.code).toBe('CLIENT_HEADER_REQUIRED');
    const limited = run(new AppHttpException('RATE_LIMITED', { retryAfterSeconds: 42 }));
    expect(limited.statusCode).toBe(429);
    expect(limited.body?.error.details).toEqual({ retryAfterSeconds: 42 });
    expect(limited.headers['Retry-After']).toBe('42');
  });

  it.each([
    ['TOKEN_EXPIRED', status.FAILED_PRECONDITION, 410],
    ['IDEMPOTENCY_KEY_REUSED', status.FAILED_PRECONDITION, 422],
    ['APP_VERSION_UNSUPPORTED', status.FAILED_PRECONDITION, 426],
    ['AI_OUTPUT_REJECTED', status.INTERNAL, 502],
    ['EMAIL_TAKEN', status.ALREADY_EXISTS, 409],
    ['RESOURCE_NOT_FOUND', status.NOT_FOUND, 404],
    ['ENTITLEMENTS_UNAVAILABLE', status.UNAVAILABLE, 503],
  ] as const)('maps a peer %s to its registered HTTP status', (code, grpc, http) => {
    const res = run(grpcError(grpc, { 'wf-error-code': code }));
    expect(res.statusCode).toBe(http);
    expect(res.body?.error.code).toBe(code);
  });

  it('ignores a lying wf-http-status for a code the gateway knows', () => {
    const res = run(
      grpcError(status.FAILED_PRECONDITION, {
        'wf-error-code': 'TOKEN_EXPIRED',
        'wf-http-status': '418',
      }),
    );
    expect(res.statusCode).toBe(410);
  });

  it('answers an UNKNOWN code with its wf-http-status and keeps the code', () => {
    // A literal cast: a service deployed with a new code before the gateway.
    const res = run(
      grpcError(status.FAILED_PRECONDITION, {
        'wf-error-code': 'NEWER_CODE',
        'wf-http-status': '422',
      }),
    );
    expect(res.statusCode).toBe(422);
    expect(res.body?.error.code).toBe('NEWER_CODE');
  });

  it('answers an unknown code without a usable header by its gRPC status', () => {
    const res = run(
      grpcError(status.NOT_FOUND, { 'wf-error-code': 'NEWER_CODE', 'wf-http-status': '999' }),
    );
    expect(res.statusCode).toBe(404);
    expect(res.body?.error.code).toBe('NEWER_CODE');
  });

  it('passes details through from trailing metadata', () => {
    const res = run(
      grpcError(status.FAILED_PRECONDITION, {
        'wf-error-code': 'PLACE_LIMIT_REACHED',
        'wf-error-details': '{"limit":1}',
      }),
    );
    expect(res.body?.error.details).toEqual({ limit: 1 });
  });

  it('maps a peer that is DOWN to 503 UPSTREAM_UNAVAILABLE with Retry-After', () => {
    const res = run(grpcError(status.UNAVAILABLE));
    expect(res.statusCode).toBe(503);
    expect(res.body?.error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(res.headers['Retry-After']).toBe('5');
  });

  it('maps a peer that is SLOW to 504 UPSTREAM_TIMEOUT', () => {
    const res = run(grpcError(status.DEADLINE_EXCEEDED));
    expect(res.statusCode).toBe(504);
    expect(res.body?.error.code).toBe('UPSTREAM_TIMEOUT');
  });

  it('maps a gRPC error WITHOUT a code to 500 INTERNAL', () => {
    expect(run(grpcError(status.INTERNAL)).body?.error.code).toBe('INTERNAL');
  });

  it('maps framework errors: an unmatched route and a malformed body', () => {
    expect(run(new NotFoundException()).body?.error.code).toBe('ROUTE_NOT_FOUND');
    expect(run(new BadRequestException('Unexpected token')).body?.error.code).toBe(
      'MALFORMED_REQUEST',
    );
  });

  it('maps anything else to 500 INTERNAL', () => {
    const res = run(new TypeError('boom'));
    expect(res.statusCode).toBe(500);
    expect(res.body?.error.code).toBe('INTERNAL');
  });

  it('always carries a requestId', () => {
    expect(run(new TypeError('boom')).body?.error.requestId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is SILENT in production for 5xx and 403, keeping the code', () => {
    const internal = run(new TypeError('secret detail'), true);
    expect(internal.body?.error).toMatchObject({
      code: 'INTERNAL',
      message: 'Something went wrong',
    });
    const forbidden = run(
      grpcError(status.PERMISSION_DENIED, { 'wf-error-code': 'PERMISSION_DENIED' }),
      true,
    );
    expect(forbidden.body?.error).toMatchObject({
      code: 'PERMISSION_DENIED',
      message: 'Forbidden',
    });
  });
});

describe('toJsonPointer', () => {
  it('escapes ~ and / per RFC 6901', () => {
    expect(toJsonPointer(['a/b', 'c~d', 0])).toBe('/a~1b/c~0d/0');
    expect(toJsonPointer([])).toBe('');
  });
});
