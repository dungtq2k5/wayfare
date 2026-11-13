import { connectivityState as ConnectivityState, Metadata, status } from '@grpc/grpc-js';
import type { ClientGrpc } from '@nestjs/microservices';
import { newId } from '@wayfare/contracts';
import type { Observable } from 'rxjs';
import { of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { unpackCallerContext } from './caller-context';
import { BaseGrpcClient } from './base-grpc.client';
import { DEFAULT_GRPC_DEADLINE_MS, GrpcServiceCaller } from './grpc-service-caller';

interface EchoService {
  echo(request: { value: string }, metadata?: Metadata): Observable<{ value: string }>;
}

const caller = () =>
  ({ kind: 'device', deviceId, origin: { ip: '203.0.113.1', userAgent: null } }) as const;

/** The caller under test, with the one-method surface the cases use. */
class EchoClient {
  private readonly echoCaller: GrpcServiceCaller<EchoService>;

  constructor(grpc: ClientGrpc) {
    this.echoCaller = new GrpcServiceCaller<EchoService>(grpc, 'EchoService');
  }

  onModuleInit(): void {
    this.echoCaller.init();
  }

  echo(value: string) {
    return this.echoCaller.call('echo', { value }, caller());
  }
}

/** A single-stub client, which only delegates. */
class LegacyEchoClient extends BaseGrpcClient<EchoService> {
  constructor(grpc: ClientGrpc) {
    super(grpc, 'EchoService');
  }

  echo(value: string) {
    return this.call('echo', { value }, caller());
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
      ({
        getChannel: () => ({
          getConnectivityState: () => channelState,
          watchConnectivityState: () => undefined,
        }),
      }) as never,
  } as ClientGrpc;
}

/** A channel whose state the test moves, as grpc-js would, recording each ask to connect. */
class FakeChannel {
  connects = 0;
  private watcher: (() => void) | null = null;

  constructor(private state: ConnectivityState) {}

  getConnectivityState(tryToConnect: boolean): ConnectivityState {
    if (tryToConnect && this.state === ConnectivityState.IDLE) {
      this.connects += 1;
      this.state = ConnectivityState.CONNECTING;
    }
    return this.state;
  }

  watchConnectivityState(
    _current: ConnectivityState,
    deadline: number,
    callback: () => void,
  ): void {
    expect(deadline).toBe(Infinity);
    this.watcher = callback;
  }

  moveTo(state: ConnectivityState): void {
    this.state = state;
    const watcher = this.watcher;
    this.watcher = null;
    watcher?.();
  }
}

const withChannel = (channel: FakeChannel): ClientGrpc =>
  ({
    getService: () => ({ echo: (request: { value: string }) => of(request) }) as never,
    getClientByServiceName: () => ({ getChannel: () => channel }) as never,
  }) as ClientGrpc;

describe('GrpcServiceCaller keeps its channel connected', () => {
  it('connects at init, not on the first call', () => {
    const channel = new FakeChannel(ConnectivityState.IDLE);
    new EchoClient(withChannel(channel)).onModuleInit();
    expect(channel.connects).toBe(1);
  });

  it('connects again when the channel falls idle', () => {
    const channel = new FakeChannel(ConnectivityState.IDLE);
    new EchoClient(withChannel(channel)).onModuleInit();
    channel.moveTo(ConnectivityState.READY);
    channel.moveTo(ConnectivityState.IDLE);
    expect(channel.connects).toBe(2);
  });

  it('stops watching once the channel shuts down', () => {
    const channel = new FakeChannel(ConnectivityState.READY);
    new EchoClient(withChannel(channel)).onModuleInit();
    channel.moveTo(ConnectivityState.SHUTDOWN);
    channel.moveTo(ConnectivityState.IDLE);
    expect(channel.connects).toBe(0);
  });
});

describe('GrpcServiceCaller.call', () => {
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

describe('BaseGrpcClient', () => {
  it('delegates to one caller, deadline and metadata included', async () => {
    let seen: Metadata | undefined;
    const client = new LegacyEchoClient(
      fakeGrpc((request, metadata) => {
        seen = metadata;
        return of(request);
      }, ConnectivityState.READY),
    );
    client.onModuleInit();
    expect(await client.echo('hi')).toEqual({ value: 'hi' });
    expect(unpackCallerContext(seen)).toMatchObject({ kind: 'device', deviceId });
  });
});
