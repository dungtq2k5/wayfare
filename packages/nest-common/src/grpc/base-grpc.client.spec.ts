import { connectivityState as ConnectivityState, Metadata, status } from '@grpc/grpc-js';
import type { ClientGrpc } from '@nestjs/microservices';
import { newId } from '@wayfare/contracts';
import type { Observable } from 'rxjs';
import { of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { unpackCallerContext } from './caller-context';
import { BaseGrpcClient, DEFAULT_GRPC_DEADLINE_MS } from './base-grpc.client';

interface EchoService {
  echo(request: { value: string }, metadata?: Metadata): Observable<{ value: string }>;
}

class EchoClient extends BaseGrpcClient<EchoService> {
  constructor(grpc: ClientGrpc) {
    super(grpc, 'EchoService');
  }

  echo(value: string) {
    return this.call(
      'echo',
      { value },
      { kind: 'device', deviceId, origin: { ip: '203.0.113.1', userAgent: null } },
    );
  }
}

const deviceId = newId();

function grpcError(code: status): Error {
  return Object.assign(new Error('x'), {
    code,
    details: 'Deadline exceeded',
    metadata: new Metadata(),
  });
}

function fakeGrpc(
  implementation: (
    request: { value: string },
    metadata: Metadata,
    options: { deadline: number },
  ) => Observable<{ value: string }>,
  channelState: number,
): ClientGrpc {
  return {
    getService: () => ({ echo: implementation }) as never,
    getClientByServiceName: () =>
      ({ getChannel: () => ({ getConnectivityState: () => channelState }) }) as never,
  } as ClientGrpc;
}

describe('BaseGrpcClient.call', () => {
  it('attaches the caller as metadata and a deadline', async () => {
    let seen: { metadata?: Metadata; deadline?: number } = {};
    const client = new EchoClient(
      fakeGrpc((request, metadata, options) => {
        seen = { metadata, deadline: options.deadline };
        return of(request);
      }, ConnectivityState.READY),
    );
    client.onModuleInit();
    const before = Date.now();
    expect(await client.echo('hi')).toEqual({ value: 'hi' });
    expect(unpackCallerContext(seen.metadata)).toMatchObject({ kind: 'device', deviceId });
    expect(seen.deadline).toBeGreaterThanOrEqual(before + DEFAULT_GRPC_DEADLINE_MS);
  });

  it('reports a deadline on a channel that never CONNECTED as UNAVAILABLE — the peer is down', async () => {
    const client = new EchoClient(
      fakeGrpc(
        () => throwError(() => grpcError(status.DEADLINE_EXCEEDED)),
        ConnectivityState.CONNECTING,
      ),
    );
    client.onModuleInit();
    await expect(client.echo('hi')).rejects.toMatchObject({ code: status.UNAVAILABLE });
  });

  it('keeps DEADLINE_EXCEEDED for a connected peer that was merely slow', async () => {
    const client = new EchoClient(
      fakeGrpc(
        () => throwError(() => grpcError(status.DEADLINE_EXCEEDED)),
        ConnectivityState.READY,
      ),
    );
    client.onModuleInit();
    await expect(client.echo('hi')).rejects.toMatchObject({ code: status.DEADLINE_EXCEEDED });
  });

  it('passes every other error through unchanged', async () => {
    const client = new EchoClient(
      fakeGrpc(() => throwError(() => grpcError(status.NOT_FOUND)), ConnectivityState.CONNECTING),
    );
    client.onModuleInit();
    await expect(client.echo('hi')).rejects.toMatchObject({ code: status.NOT_FOUND });
  });

  it('refuses to call before module init', async () => {
    const client = new EchoClient(fakeGrpc(() => of({ value: '' }), ConnectivityState.READY));
    await expect(client.echo('hi')).rejects.toThrow(/before module init/);
  });
});
