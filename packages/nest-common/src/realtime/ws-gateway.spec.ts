import { Metadata, status } from '@grpc/grpc-js';
import type { ArgumentsHost } from '@nestjs/common';
import { GATEWAY_OPTIONS } from '@nestjs/websockets/constants';
import { describe, expect, it } from 'vitest';
import { WayfareGateway, WsError, WsErrorFilter, wsErrorCode } from './ws-gateway';

const grpcError = (code: number, entries: Record<string, string> = {}) => {
  const metadata = new Metadata();
  for (const [key, value] of Object.entries(entries)) metadata.set(key, value);
  return Object.assign(new Error('grpc'), { code, details: 'x', metadata });
};

describe('wsErrorCode', () => {
  it('keeps a refusal, maps a peer, and hides anything else', () => {
    expect(wsErrorCode(new WsError('PERMISSION_DENIED'))).toEqual({
      code: 'PERMISSION_DENIED',
      expected: true,
    });
    expect(
      wsErrorCode(grpcError(status.NOT_FOUND, { 'wf-error-code': 'RESOURCE_NOT_FOUND' })).code,
    ).toBe('RESOURCE_NOT_FOUND');
    expect(wsErrorCode(grpcError(status.UNAVAILABLE)).code).toBe('UPSTREAM_UNAVAILABLE');
    expect(wsErrorCode(new Error('boom'))).toEqual({ code: 'INTERNAL', expected: false });
  });
});

describe('WsErrorFilter', () => {
  it('emits error { code } on the socket', () => {
    const emitted: unknown[] = [];
    const host = {
      switchToWs: () => ({
        getClient: () => ({ emit: (...args: unknown[]) => emitted.push(args) }),
      }),
    } as unknown as ArgumentsHost;
    new WsErrorFilter().catch(new WsError('VALIDATION_FAILED'), host);
    expect(emitted).toEqual([['error', { code: 'VALIDATION_FAILED' }]]);
  });
});

describe('WayfareGateway', () => {
  it('forces the namespace and the WebSocket transport over the caller', () => {
    @WayfareGateway({ namespace: '/other', transports: ['polling'] } as never)
    class Events {}
    const options = Reflect.getMetadata(GATEWAY_OPTIONS, Events) as {
      namespace: string;
      transports: string[];
    };
    expect(options).toMatchObject({ namespace: '/ws', transports: ['websocket'] });
  });
});
