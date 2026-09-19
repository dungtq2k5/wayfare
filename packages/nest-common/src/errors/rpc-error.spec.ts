import { Metadata, status } from '@grpc/grpc-js';
import type { ServiceError } from '@grpc/grpc-js';
import { compareStrings, ERROR_CODES, ERRORS } from '@wayfare/contracts';
import type { ErrorCode } from '@wayfare/contracts';
import type { RpcException } from '@nestjs/microservices';
import { describe, expect, it } from 'vitest';
import { isGrpcServiceError, readGrpcErrorInfo } from './grpc-service-error';
import { GRPC_STATUS_BY_NAME, rpcError } from './rpc-error';
import type { RpcErrorObject } from './rpc-error';

// Each code with details, and a valid value for it.
const VALID_DETAILS: Partial<Record<ErrorCode, unknown>> = {
  VALIDATION_FAILED: { issues: [{ path: '/a', code: 'invalid_type' }] },
  PERMISSION_DENIED: { required: ['place.update'] },
  RESOURCE_NOT_FOUND: { resource: 'PLACE' },
  INVALID_STATE: { status: 'ACTIVE' },
  PAYOUT_CHANGES_COOLING_DOWN: { until: '2026-09-23T00:00:00.000Z' },
  PLACE_LIMIT_REACHED: { limit: 1 },
  PHOTO_LIMIT_REACHED: { limit: 3 },
  MENU_LIMIT_REACHED: { limit: 10 },
  STAFF_LIMIT_REACHED: { limit: 10 },
  BOOST_SLOTS_EXCEEDED: { limit: 1 },
  VOUCHER_NOT_REDEEMABLE: { status: 'REDEEMED', redeemedAt: '2026-09-16T00:00:00.000Z' },
  PRICE_BELOW_MINIMUM: { minimum: { amountMinor: 300, currency: 'USD' } },
  APP_VERSION_UNSUPPORTED: { minimumVersion: '1.2.0' },
  RATE_LIMITED: { retryAfterSeconds: 30 },
  SHORT_CODE_ENTRY_PAUSED: { retryAfterSeconds: 600 },
  AI_QUOTA_EXHAUSTED: { resetsAt: '2026-09-17T00:00:00.000+07:00' },
  LEGAL_VERSION_OUTDATED: { document: 'PRIVACY_POLICY', currentVersion: '2026-09-01' },
  OWNER_HAS_ACTIVE_OBLIGATIONS: { subscriptionEndsAt: '2026-10-19T10:00:00.000Z' },
  OWNER_HAS_LIVE_VOUCHERS: { issuedVoucherCount: 2, openCheckoutCount: 1 },
  ROLE_IN_USE: { holders: 3 },
  SUBMISSION_CONFLICT: { changedFields: ['phone'] },
  ROLE_TOO_WIDE_TO_EDIT: { holders: 501, limit: 500 },
  PERMISSION_RETIRED: { codes: ['user.read'] },
  AREA_OVERLAPS: { codes: ['hcmc-d1-core'] },
  AREA_EXCLUDES_PLACES: { count: 1, placeIds: ['01a0b373-d3eb-73c0-bd63-b96a868ab216'] },
  AREA_HAS_LIVE_PLACES: { count: 10 },
};

// The signature forbids a mismatch at compile time; this reaches the runtime check.
const untypedRpcError = rpcError as unknown as (...args: unknown[]) => RpcException;
const loose = (code: ErrorCode, details?: unknown): RpcException => untypedRpcError(code, details);

describe('rpcError', () => {
  it('knows every code that has a details schema', () => {
    const withDetails = ERROR_CODES.filter((code) => 'details' in ERRORS[code]);
    expect(Object.keys(VALID_DETAILS).toSorted(compareStrings)).toEqual(
      withDetails.toSorted(compareStrings),
    );
  });

  it.each(ERROR_CODES)('%s travels with its registered statuses', (code) => {
    const error = loose(code, VALID_DETAILS[code]).getError() as RpcErrorObject;
    expect(error.code).toBe(GRPC_STATUS_BY_NAME[ERRORS[code].grpc]);
    expect(error.metadata).toBeInstanceOf(Metadata);
    expect(error.metadata.get('wf-error-code')).toEqual([code]);
    expect(error.metadata.get('wf-http-status')).toEqual([String(ERRORS[code].http)]);
    const details = VALID_DETAILS[code];
    expect(error.metadata.get('wf-error-details')).toEqual(
      details === undefined ? [] : [JSON.stringify(details)],
    );
  });

  it('types the details argument per code', () => {
    expect(rpcError('INTERNAL')).toBeDefined();
    expect(rpcError('PLACE_LIMIT_REACHED', { limit: 1 })).toBeDefined();
    // @ts-expect-error — a code without a schema takes no details.
    expect(() => rpcError('INTERNAL', { a: 1 })).toThrow(/INTERNAL/);
    // @ts-expect-error — a code with a schema requires them.
    expect(rpcError('PLACE_LIMIT_REACHED')).toBeDefined();
  });

  it.each([
    ['PLACE_LIMIT_REACHED', { limit: 'one' }],
    ['PLACE_LIMIT_REACHED', { limit: 1, extra: true }],
    ['RESOURCE_NOT_FOUND', { resource: 'place' }],
    ['VALIDATION_FAILED', { issues: [] }],
  ] as const)('%s refuses bad details %j — a bug in the thrower', (code, details) => {
    expect(() => loose(code, details)).toThrow(new RegExp(code));
  });
});

function serviceError(code: status, entries: Record<string, string> = {}): ServiceError {
  const metadata = new Metadata();
  for (const [key, value] of Object.entries(entries)) metadata.set(key, value);
  return Object.assign(new Error('x'), { code, details: 'x', metadata });
}

describe('client-side gRPC errors', () => {
  it('recognizes a ServiceError by shape, not by class', () => {
    expect(isGrpcServiceError(serviceError(status.UNAVAILABLE))).toBe(true);
    expect(isGrpcServiceError(new Error('plain'))).toBe(false);
    expect(isGrpcServiceError({ code: 14, metadata: {} })).toBe(false);
  });

  it('reads a known code with its REGISTERED status, ignoring a lying header', () => {
    const info = readGrpcErrorInfo(
      serviceError(status.FAILED_PRECONDITION, {
        'wf-error-code': 'TOKEN_EXPIRED',
        'wf-http-status': '418',
        'wf-error-details': '{"a":1}',
      }),
    );
    expect(info).toEqual({
      code: 'TOKEN_EXPIRED',
      httpStatus: 410,
      known: true,
      details: { a: 1 },
    });
  });

  it("reads an unknown code with the header's status, and keeps the code", () => {
    const info = readGrpcErrorInfo(
      serviceError(status.FAILED_PRECONDITION, {
        'wf-error-code': 'NEW_CODE',
        'wf-http-status': '422',
      }),
    );
    expect(info).toEqual({ code: 'NEW_CODE', httpStatus: 422, known: false, details: null });
  });

  it('falls back to the gRPC mapping for an unknown code with an illegal or missing header', () => {
    const read = (entries: Record<string, string>) =>
      readGrpcErrorInfo(serviceError(status.NOT_FOUND, { 'wf-error-code': 'NEW_CODE', ...entries }))
        ?.httpStatus;
    expect(read({ 'wf-http-status': '418' })).toBe(404);
    expect(read({ 'wf-http-status': 'x' })).toBe(404);
    expect(read({})).toBe(404);
    expect(
      readGrpcErrorInfo(serviceError(status.DATA_LOSS, { 'wf-error-code': 'NEW_CODE' }))
        ?.httpStatus,
    ).toBe(500);
  });

  it('drops malformed details but keeps the code', () => {
    expect(
      readGrpcErrorInfo(
        serviceError(status.INTERNAL, { 'wf-error-code': 'INTERNAL', 'wf-error-details': '{' }),
      ),
    ).toEqual({ code: 'INTERNAL', httpStatus: 500, known: true, details: null });
  });

  it('is null without a code', () => {
    expect(readGrpcErrorInfo(serviceError(status.UNAVAILABLE))).toBeNull();
  });
});
