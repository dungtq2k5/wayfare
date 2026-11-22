import { describe, expect, it, vi } from 'vitest';
import { NatsClient } from './nats.client';

/** A client over a fake connection and JetStream: the private constructor, reached for a test. */
function client(closed: boolean) {
  const connection = {
    isClosed: vi.fn(() => closed),
    flush: vi.fn(() => Promise.resolve()),
    drain: vi.fn(() => Promise.resolve()),
  };
  const js = { publish: vi.fn(() => Promise.resolve({})) };
  const Build = NatsClient as unknown as new (c: unknown, js: unknown, jsm: unknown) => NatsClient;
  return { connection, js, nats: new Build(connection, js, {}) };
}

describe('the NATS client', () => {
  it('publishes with the message id for deduplication, and the headers given', async () => {
    const { js, nats } = client(false);
    const data = new Uint8Array([1]);
    await nats.publish('audit.record', data, {
      msgId: 'm1',
      headers: { traceparent: 't' },
      timeoutMs: 500,
    });
    await nats.publish('audit.record', data, { headers: {}, timeoutMs: 500 });
    type Call = [string, Uint8Array, Record<string, unknown>];
    const [first, second] = js.publish.mock.calls as unknown as [Call, Call];
    expect(first[2]).toMatchObject({ msgID: 'm1', timeout: 500 });
    expect((first[2].headers as { get(key: string): string }).get('traceparent')).toBe('t');
    expect(second[2]).not.toHaveProperty('msgID');
  });

  it('is ready while open and answering, and not once closed', async () => {
    const open = client(false);
    await expect(open.nats.readinessCheck().check()).resolves.toBeUndefined();
    expect(open.connection.flush).toHaveBeenCalled();
    await expect(client(true).nats.readinessCheck().check()).rejects.toThrow('connection closed');
  });

  it('drains on close, unless the connection is closed already', async () => {
    const open = client(false);
    await open.nats.close();
    expect(open.connection.drain).toHaveBeenCalled();
    const closed = client(true);
    await closed.nats.close();
    expect(closed.connection.drain).not.toHaveBeenCalled();
  });
});
