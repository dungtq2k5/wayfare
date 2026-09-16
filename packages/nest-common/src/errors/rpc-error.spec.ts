import { Metadata, status } from '@grpc/grpc-js';
import type { ServiceError } from '@grpc/grpc-js';
import { describe, expect, it } from 'vitest';
import { isGrpcServiceError, readGrpcErrorInfo } from './grpc-service-error';
import { rpcError } from './rpc-error';
import type { RpcErrorObject } from './rpc-error';

describe('rpcError', () => {
  it('carries the error code in a REAL grpc-js Metadata instance', () => {
    const error = rpcError(status.NOT_FOUND, 'PLACE_NOT_FOUND').getError() as RpcErrorObject;
    expect(error.code).toBe(status.NOT_FOUND);
    expect(error.metadata).toBeInstanceOf(Metadata);
    expect(error.metadata.get('wf-error-code')).toEqual(['PLACE_NOT_FOUND']);
    expect(error.metadata.get('wf-http-status')).toEqual([]);
  });

  it('adds the HTTP override and details only when given', () => {
    const error = rpcError(
      status.FAILED_PRECONDITION,
      'PLACE_LIMIT_REACHED',
      { limit: 1 },
      { http: 422 },
    ).getError() as RpcErrorObject;
    expect(error.metadata.get('wf-http-status')).toEqual(['422']);
    expect(error.metadata.get('wf-error-details')).toEqual(['{"limit":1}']);
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

  it('reads the Wayfare fields from trailing metadata', () => {
    const info = readGrpcErrorInfo(
      serviceError(status.FAILED_PRECONDITION, {
        'wf-error-code': 'X',
        'wf-http-status': '410',
        'wf-error-details': '{"a":1}',
      }),
    );
    expect(info).toEqual({ errorCode: 'X', httpStatus: 410, details: { a: 1 } });
  });

  it('drops malformed details but keeps the code', () => {
    expect(
      readGrpcErrorInfo(
        serviceError(status.INTERNAL, { 'wf-error-code': 'X', 'wf-error-details': '{' }),
      ),
    ).toEqual({ errorCode: 'X', httpStatus: null, details: null });
  });
});
