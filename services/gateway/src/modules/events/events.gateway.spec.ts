import { newId } from '@wayfare/contracts';
import type { AccountClaims } from '@wayfare/contracts';
import type { AccountTokenVerifier } from '@wayfare/nest-common';
import type { Socket } from 'socket.io';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NarrationServiceGrpcClient } from '../narration-client/narration-service-grpc.client';
import { EventsGateway } from './events.gateway';

const ORIGIN = 'http://localhost:5173';

function fakeSocket() {
  const emitted: [string, unknown][] = [];
  const socket = {
    id: newId(),
    handshake: {
      headers: { origin: ORIGIN, cookie: 'wf_at=token' },
      auth: { client: 'console' },
      address: '127.0.0.1',
    },
    emitted,
    disconnected: false,
    emit: (event: string, payload: unknown) => emitted.push([event, payload]),
    join: () => Promise.resolve(),
    disconnect() {
      this.disconnected = true;
    },
  };
  return socket;
}

describe('EventsGateway expiry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('disconnects a socket when its token expires', async () => {
    const exp = Math.floor(Date.now() / 1000) + 90;
    const claims = {
      sub: newId(),
      sid: newId(),
      exp,
      perms: [],
      ov: false,
      ev: true,
    } as unknown as AccountClaims;
    const verifier = {
      verify: () => ({ type: 'account', claims }),
      check: () => Promise.resolve({ kind: 'valid', claims }),
    } as unknown as AccountTokenVerifier;
    const config = { get: () => [ORIGIN] };
    const gateway = new EventsGateway(
      verifier,
      {} as NarrationServiceGrpcClient,
      config as never,
      60_000,
    );
    const socket = fakeSocket();

    await gateway.handleConnection(socket as unknown as Socket);
    expect(socket.emitted).toEqual([['connection:ready', {}]]);
    vi.advanceTimersByTime(89_000);
    expect(socket.disconnected).toBe(false);
    vi.advanceTimersByTime(1_000);
    expect(socket.emitted.at(-1)).toEqual(['error', { code: 'UNAUTHENTICATED' }]);
    expect(socket.disconnected).toBe(true);
    gateway.onModuleDestroy();
  });
});
