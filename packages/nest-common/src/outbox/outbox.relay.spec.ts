import { describe, expect, it } from 'vitest';
import type { RawSqlTx, RelayDb } from '../prisma/helpers';
import {
  OUTBOX_BATCH_SIZE,
  OUTBOX_PUBLISH_TIMEOUT_MS,
  OUTBOX_TX_TIMEOUT_MS,
  OutboxRelay,
} from './outbox.relay';
import type { EventPublisher } from './outbox.relay';

interface Row {
  id: string;
  subject: string;
  payload: unknown;
  trace_parent: string | null;
}

class FakeDb implements RelayDb {
  readonly executed: { sql: string; values: unknown[] }[] = [];
  readonly transactionOptions: unknown[] = [];

  constructor(private readonly rows: Row[]) {}

  $transaction<R>(fn: (tx: RawSqlTx) => Promise<R>, options?: { timeout?: number }): Promise<R> {
    this.transactionOptions.push(options);
    return fn(this);
  }

  $queryRaw<T>(): Promise<T> {
    return Promise.resolve(this.rows as T);
  }

  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number> {
    this.executed.push({ sql: query.join('?').replace(/\s+/g, ' ').trim(), values });
    return Promise.resolve(1);
  }
}

class FakePublisher implements EventPublisher {
  readonly published: { subject: string; msgId: string; body: unknown }[] = [];

  constructor(private readonly failOn: Set<string> = new Set()) {}

  publish(subject: string, data: Uint8Array, options: { msgId: string }): Promise<void> {
    if (this.failOn.has(options.msgId)) return Promise.reject(new Error('broker unavailable'));
    this.published.push({
      subject,
      msgId: options.msgId,
      body: JSON.parse(new TextDecoder().decode(data)),
    });
    return Promise.resolve();
  }
}

const row = (id: string): Row => ({
  id,
  subject: 'audit.record',
  payload: { eventId: id },
  trace_parent: null,
});

describe('OutboxRelay cycle', () => {
  it('publishes in id order with Nats-Msg-Id = id and marks every published row', async () => {
    const db = new FakeDb([row('a'), row('b'), row('c')]);
    const publisher = new FakePublisher();
    const result = await new OutboxRelay(db, publisher).runOnce();

    expect(publisher.published.map((p) => p.msgId)).toEqual(['a', 'b', 'c']);
    expect(publisher.published[0]?.body).toEqual({ eventId: 'a' });
    expect(result).toEqual({ claimed: 3, published: 3, failed: false });
    const mark = db.executed.find((e) => e.sql.includes('published_at = now()'));
    expect(mark?.values).toEqual([['a', 'b', 'c']]);
  });

  it('STOPS at the first failure, records it, and marks only the rows before it', async () => {
    const db = new FakeDb([row('a'), row('b'), row('c')]);
    const publisher = new FakePublisher(new Set(['b']));
    const result = await new OutboxRelay(db, publisher).runOnce();

    expect(publisher.published.map((p) => p.msgId)).toEqual(['a']); // c is never attempted
    expect(result).toEqual({ claimed: 3, published: 1, failed: true });
    const failure = db.executed.find((e) => e.sql.includes('last_error ='));
    expect(failure?.values).toEqual(['broker unavailable', 'b']);
    const mark = db.executed.find((e) => e.sql.includes('published_at = now()'));
    expect(mark?.values).toEqual([['a']]);
  });

  it('marks nothing when nothing was claimed', async () => {
    const db = new FakeDb([]);
    expect(await new OutboxRelay(db, new FakePublisher()).runOnce()).toEqual({
      claimed: 0,
      published: 0,
      failed: false,
    });
    expect(db.executed).toHaveLength(0);
  });

  it('sizes the claim transaction for a whole batch of slow publishes', async () => {
    const db = new FakeDb([]);
    await new OutboxRelay(db, new FakePublisher()).runOnce();
    expect(db.transactionOptions[0]).toEqual({ timeout: OUTBOX_TX_TIMEOUT_MS });
    expect(OUTBOX_TX_TIMEOUT_MS).toBeGreaterThan(OUTBOX_BATCH_SIZE * OUTBOX_PUBLISH_TIMEOUT_MS);
  });
});

describe('OutboxRelay loop', () => {
  it('re-polls IMMEDIATELY after a full batch and stops cleanly', async () => {
    let cycles = 0;
    const full = Array.from({ length: OUTBOX_BATCH_SIZE }, (_, i) => row(String(i)));
    const db = new FakeDb([]);
    db.$queryRaw = <T>() => {
      cycles++;
      return Promise.resolve((cycles <= 3 ? full : []) as T);
    };
    const relay = new OutboxRelay(db, new FakePublisher());
    relay.start();
    await new Promise((resolve) => setTimeout(resolve, 50)); // far less than one 200 ms poll
    await relay.stop();
    expect(cycles).toBeGreaterThanOrEqual(4);
  });
});
