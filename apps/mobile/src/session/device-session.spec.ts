import { apiFetch, configureApiClient } from '@wayfare/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { createDeviceSession } from './device-session';
import type { CredentialStore, DeviceApi, DeviceCredentials } from './device-session';

/** The URL of a `fetch` input. */
const urlOf = (input: string | URL | Request): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const failure = (status: number, code: string): Response =>
  json(status, { error: { code, message: code, requestId: 'req' } });

/** A gateway that issues tokens, accepts the latest one on `/protected`, and can revoke a device. */
class FakeGateway {
  readonly calls: string[] = [];
  readonly devices = new Map<string, string>();
  validToken: string | null = null;
  issued = 0;
  revoked = false;
  exchangeDelayMs = 0;

  private issue(): string {
    this.issued += 1;
    this.validToken = `token-${this.issued}`;
    return this.validToken;
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const path = urlOf(input).replace('http://api.test', '');
    this.calls.push(`${init?.method ?? 'GET'} ${path}`);
    const headers = new Headers(init?.headers);
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, string>) : {};
    if (path === '/devices') {
      const deviceId = `device-${this.devices.size + 1}`;
      this.devices.set(deviceId, 'secret');
      return json(201, {
        data: { deviceId, deviceSecret: 'secret', accessToken: this.issue(), expiresIn: 900 },
      });
    }
    if (path === '/devices/token') {
      if (this.exchangeDelayMs > 0) await new Promise((r) => setTimeout(r, this.exchangeDelayMs));
      if (this.revoked || this.devices.get(body.deviceId ?? '') !== body.deviceSecret)
        return failure(401, 'DEVICE_REVOKED');
      return json(200, { data: { accessToken: this.issue(), expiresIn: 900 } });
    }
    if (path === '/protected') {
      if (this.revoked) return failure(401, 'DEVICE_REVOKED');
      return headers.get('authorization') === `Bearer ${this.validToken}`
        ? json(200, { data: 'secret data' })
        : failure(401, 'UNAUTHENTICATED');
    }
    return failure(404, 'RESOURCE_NOT_FOUND');
  };
}

class MemoryStore implements CredentialStore {
  deviceId: string | null = null;
  deviceSecret: string | null = null;
  load() {
    return Promise.resolve({ deviceId: this.deviceId, deviceSecret: this.deviceSecret });
  }
  save(credentials: DeviceCredentials) {
    this.deviceId = credentials.deviceId;
    this.deviceSecret = credentials.deviceSecret;
    return Promise.resolve();
  }
  clear() {
    this.deviceId = null;
    this.deviceSecret = null;
    return Promise.resolve();
  }
}

interface Registration {
  contentLocale: string;
}

const api: DeviceApi<Registration> = {
  async register(registration) {
    const response = await apiFetch<{ data: DeviceCredentials & { accessToken: string } }>(
      '/devices',
      { method: 'POST', body: JSON.stringify(registration), anonymous: true },
    );
    return response.data;
  },
  async exchange(credentials) {
    const response = await apiFetch<{ data: { accessToken: string } }>('/devices/token', {
      method: 'POST',
      body: JSON.stringify(credentials),
      anonymous: true,
    });
    return response.data;
  },
};

let gateway: FakeGateway;
let store: MemoryStore;
let onRevoked: Mock<() => void>;

function start() {
  const session = createDeviceSession({ store, api, onRevoked });
  configureApiClient({
    baseUrl: 'http://api.test',
    client: 'mobile',
    session,
    fetch: gateway.fetch,
  });
  return session;
}

const protectedCall = () => apiFetch<{ data: string }>('/protected');

beforeEach(() => {
  gateway = new FakeGateway();
  store = new MemoryStore();
  onRevoked = vi.fn<() => void>();
});

describe('the device session', () => {
  it('registers once, keeps the pair, and sends the token it was given', async () => {
    const session = start();
    expect(await session.isRegistered()).toBe(false);
    await session.register({ contentLocale: 'en' });
    expect(await session.isRegistered()).toBe(true);
    await expect(protectedCall()).resolves.toEqual({ data: 'secret data' });
    expect(gateway.calls).toEqual(['POST /devices', 'GET /protected']);
  });

  it('a relaunch exchanges the stored pair for a token, and never registers again', async () => {
    gateway.devices.set('device-1', 'secret');
    store.deviceId = 'device-1';
    store.deviceSecret = 'secret';
    start();
    await expect(protectedCall()).resolves.toEqual({ data: 'secret data' });
    expect(gateway.calls).toEqual(['POST /devices/token', 'GET /protected']);
  });

  it('refreshes once when the token has expired, and retries once', async () => {
    const session = start();
    await session.register({ contentLocale: 'en' });
    gateway.validToken = 'rotated-elsewhere'; // the 15 minutes passed
    await expect(protectedCall()).resolves.toEqual({ data: 'secret data' });
    expect(gateway.calls).toEqual([
      'POST /devices',
      'GET /protected', // 401
      'POST /devices/token',
      'GET /protected', // retried with the new token
    ]);
  });

  it('shares one refresh between concurrent calls', async () => {
    const session = start();
    await session.register({ contentLocale: 'en' });
    gateway.validToken = 'rotated-elsewhere';
    gateway.exchangeDelayMs = 20;
    const results = await Promise.all([protectedCall(), protectedCall(), protectedCall()]);
    expect(results.map((r) => r.data)).toEqual(['secret data', 'secret data', 'secret data']);
    expect(gateway.calls.filter((call) => call === 'POST /devices/token')).toHaveLength(1);
  });

  it('a revoked device clears the pair and starts over from the notice', async () => {
    const session = start();
    await session.register({ contentLocale: 'en' });
    gateway.revoked = true;
    await expect(protectedCall()).rejects.toMatchObject({ code: 'DEVICE_REVOKED' });
    expect(await session.isRegistered()).toBe(false);
    expect(onRevoked).toHaveBeenCalledTimes(1);
    // …and the install can register anew.
    gateway.revoked = false;
    await session.register({ contentLocale: 'en' });
    expect(await session.isRegistered()).toBe(true);
    expect(gateway.devices.size).toBe(2);
  });

  it('a missing secret is a revoked device', async () => {
    store.deviceId = 'device-1';
    start();
    await expect(protectedCall()).rejects.toMatchObject({ status: 401 });
    expect(store.deviceId).toBeNull();
    expect(onRevoked).toHaveBeenCalledTimes(1);
  });

  it('an install that never registered sends anonymous calls and does not start over', async () => {
    start();
    await expect(protectedCall()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(onRevoked).not.toHaveBeenCalled();
    expect(gateway.calls).toEqual(['GET /protected']);
  });

  it('an offline refresh leaves the pair alone', async () => {
    const session = start();
    await session.register({ contentLocale: 'en' });
    gateway.validToken = 'rotated-elsewhere';
    const offline: typeof fetch = (input, init) =>
      urlOf(input).endsWith('/devices/token')
        ? Promise.reject(new TypeError('Network request failed'))
        : gateway.fetch(input, init);
    configureApiClient({ baseUrl: 'http://api.test', client: 'mobile', session, fetch: offline });
    await expect(protectedCall()).rejects.toMatchObject({ status: 401 });
    expect(await session.isRegistered()).toBe(true);
    expect(onRevoked).not.toHaveBeenCalled();
  });

  it('clear() forgets the pair without telling anyone', async () => {
    const session = start();
    await session.register({ contentLocale: 'en' });
    await session.clear();
    expect(await session.isRegistered()).toBe(false);
    expect(onRevoked).not.toHaveBeenCalled();
  });
});
