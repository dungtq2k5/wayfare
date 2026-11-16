// The socket (api-endpoints-plan §9) against the in-process gateway: the handshake's checks, the
// monitor's rooms, and revocation reaching a connected socket through revalidation.
import { newId } from '@wayfare/contracts';
import { NARRATION_FIXTURE_IDS, synthesisJobFixture } from '@wayfare/contracts/testing';
import { tokenCutoffKey } from '@wayfare/nest-common';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountToken, bootGateway } from '../support/app';
import type { E2eApp } from '../support/app';

const ORIGIN = 'http://localhost:5173';
const REVALIDATE_MS = 100;
let gateway: E2eApp;
let url: string;
const open: Socket[] = [];

beforeAll(async () => {
  gateway = await bootGateway({}, { sockets: { revalidateMs: REVALIDATE_MS } });
  const address = gateway.app.getHttpServer().address() as { port: number };
  url = `http://127.0.0.1:${address.port}/ws`;
});
afterAll(() => gateway.app.close());
beforeEach(() => {
  gateway.identity.reset();
  gateway.narration.reset();
  gateway.redis.failure = null;
  gateway.redis.values.clear();
});
afterEach(() => {
  for (const socket of open.splice(0)) socket.disconnect();
});

/** A socket as the console opens it; override any part of the handshake. */
function connect(
  options: { origin?: string | null; client?: string | null; cookie?: string | null } = {},
): Socket {
  const headers: Record<string, string> = {};
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin !== null) headers.Origin = origin;
  const cookie = options.cookie === undefined ? `wf_at=${accountToken()}` : options.cookie;
  if (cookie !== null) headers.Cookie = cookie;
  const client = options.client === undefined ? 'console' : options.client;
  const socket = io(url, {
    transports: ['websocket'],
    extraHeaders: headers,
    auth: client === null ? {} : { client },
    reconnection: false,
  });
  open.push(socket);
  return socket;
}

/** The next frame of `event`, or the reason the socket closed first. */
function next(socket: Socket, event: string, ms = 3_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event} within ${ms} ms`)), ms);
    socket.once(event, (payload: unknown) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

const closed = (socket: Socket, ms = 3_000) =>
  new Promise<void>((resolve, reject) => {
    if (socket.disconnected && !socket.active) return resolve();
    const timer = setTimeout(() => reject(new Error('still connected')), ms);
    socket.once('disconnect', () => {
      clearTimeout(timer);
      resolve();
    });
  });

describe('the handshake', () => {
  it('answers connection:ready to a console session', async () => {
    const socket = connect();
    expect(await next(socket, 'connection:ready')).toEqual({});
  });

  it.each([
    ['a foreign Origin', { origin: 'https://evil.test' }, 'PERMISSION_DENIED'],
    ['no Origin', { origin: null }, 'PERMISSION_DENIED'],
    ['another client', { client: 'web' }, 'CLIENT_HEADER_REQUIRED'],
    ['no session cookie', { cookie: null }, 'UNAUTHENTICATED'],
    ['a forged cookie', { cookie: 'wf_at=not.a.token' }, 'UNAUTHENTICATED'],
  ] as const)('refuses %s', async (_name, options, code) => {
    const socket = connect(options);
    expect(await next(socket, 'error')).toEqual({ code });
    await closed(socket);
  });

  it('refuses when revocation cannot be checked — never a pass', async () => {
    gateway.redis.failure = new Error('down');
    const socket = connect();
    expect(await next(socket, 'error')).toEqual({ code: 'UPSTREAM_UNAVAILABLE' });
    await closed(socket);
  });
});

describe('revalidation', () => {
  it('disconnects a socket soon after a newer cutoff is written', async () => {
    const userId = newId();
    const socket = connect({ cookie: `wf_at=${accountToken({ userId })}` });
    await next(socket, 'connection:ready');
    gateway.redis.values.set(tokenCutoffKey(userId), String(Date.now() + 60_000));
    expect(await next(socket, 'error', REVALIDATE_MS * 20)).toEqual({ code: 'UNAUTHENTICATED' });
    await closed(socket);
  });

  it('disconnects a socket whose check becomes unverifiable', async () => {
    const socket = connect();
    await next(socket, 'connection:ready');
    gateway.redis.failure = new Error('down');
    expect(await next(socket, 'error', REVALIDATE_MS * 20)).toEqual({
      code: 'UPSTREAM_UNAVAILABLE',
    });
    await closed(socket);
  });
});

describe('job:subscribe', () => {
  const jobId = NARRATION_FIXTURE_IDS.job;

  it('joins the job room for the monitor', async () => {
    gateway.narration.synthesisAdmin.handlers.getJob = () =>
      Promise.resolve({ job: synthesisJobFixture(), tasks: [] });
    const socket = connect({ cookie: `wf_at=${accountToken({ perms: ['narration.job.read'] })}` });
    await next(socket, 'connection:ready');
    socket.emit('job:subscribe', { jobId });
    expect(await next(socket, 'job:subscribed')).toEqual({ jobId });
    expect(gateway.narration.synthesisAdmin.calls[0]!.request).toEqual({ jobId });
  });

  it('refuses a socket without the monitor permission, and a malformed payload', async () => {
    const socket = connect();
    await next(socket, 'connection:ready');
    socket.emit('job:subscribe', { jobId });
    expect(await next(socket, 'error')).toEqual({ code: 'PERMISSION_DENIED' });
    socket.emit('job:subscribe', { jobId: 'nope' });
    expect(await next(socket, 'error')).toEqual({ code: 'VALIDATION_FAILED' });
    expect(gateway.narration.synthesisAdmin.calls).toHaveLength(0);
    expect(socket.connected).toBe(true);
  });
});
