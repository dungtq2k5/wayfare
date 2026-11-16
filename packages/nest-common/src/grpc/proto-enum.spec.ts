import { status } from '@grpc/grpc-js';
import type { RpcException } from '@nestjs/microservices';
import { Platform } from '@wayfare/contracts';
import { platformProto } from '@wayfare/contracts/grpc';
import { describe, expect, it, vi } from 'vitest';
import type { RpcErrorObject } from '../errors/rpc-error';
import { requireProtoEnum } from './proto-enum';

function rejection(value: number | null | undefined, logger: { warn: () => void }) {
  try {
    requireProtoEnum(platformProto, value, '/platform', logger);
  } catch (error) {
    return (error as RpcException).getError() as RpcErrorObject;
  }
  throw new Error('expected a rejection');
}

describe('requireProtoEnum', () => {
  it('returns the domain member for a known value', () => {
    expect(requireProtoEnum(platformProto, platformProto.toProto(Platform.WEB), '/platform')).toBe(
      Platform.WEB,
    );
  });

  it.each([0, null, undefined])('rejects %s as INVALID_ARGUMENT without logging', (value) => {
    const logger = { warn: vi.fn() };
    const error = rejection(value, logger);
    expect(error.code).toBe(status.INVALID_ARGUMENT);
    expect(error.metadata.get('wf-error-code')).toEqual(['VALIDATION_FAILED']);
    expect(JSON.parse(String(error.metadata.get('wf-error-details')[0]))).toEqual({
      issues: [{ path: '/platform', code: 'invalid_value' }],
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each([7, -1])('rejects an UNKNOWN value %s and logs it — a newer peer', (value) => {
    const logger = { warn: vi.fn() };
    expect(rejection(value, logger).code).toBe(status.INVALID_ARGUMENT);
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});
