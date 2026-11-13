import { compareStrings, newId } from '@wayfare/contracts';
import { OUTBOX_BATCH_SIZE, OutboxRelay } from '@wayfare/nest-common';
import type { EventPublisher } from '@wayfare/nest-common';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testPrisma, truncateAll } from '../setup/database';

const prisma = testPrisma();

class SlowPublisher implements EventPublisher {
  readonly ids: string[] = [];
  async publish(_subject: string, _data: Uint8Array, options: { msgId: string }): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 2));
    this.ids.push(options.msgId);
  }
}

async function seed(count: number): Promise<string[]> {
  const ids = Array.from({ length: count }, () => newId());
  await prisma.outboxEvent.createMany({
    data: ids.map((id) => ({
      id,
      subject: 'audit.record',
      payload: { eventId: id },
      aggregateId: id,
    })),
  });
  return ids;
}

beforeEach(() => truncateAll(prisma));
afterAll(() => prisma.$disconnect());

describe('outbox relay claim (raw SQL)', () => {
  it('lets two CONCURRENT relays publish every row exactly once', async () => {
    const ids = await seed(OUTBOX_BATCH_SIZE * 3 + 7);
    const a = new SlowPublisher();
    const b = new SlowPublisher();
    const relayA = new OutboxRelay(prisma, a);
    const relayB = new OutboxRelay(prisma, b);

    for (let round = 0; round < 10; round++) {
      const [ra, rb] = await Promise.all([relayA.runOnce(), relayB.runOnce()]);
      if (ra.claimed === 0 && rb.claimed === 0) break;
    }

    const all = [...a.ids, ...b.ids];
    expect(new Set(all).size).toBe(all.length); // no row published twice
    expect(all.toSorted(compareStrings)).toEqual(ids.toSorted(compareStrings)); // every row published
    expect(a.ids.length).toBeGreaterThan(0);
    expect(b.ids.length).toBeGreaterThan(0); // SKIP LOCKED actually split the work
    expect(await prisma.outboxEvent.count({ where: { publishedAt: null } })).toBe(0);
  });

  it('publishes within a batch in id order and records a failure on the row', async () => {
    const ids = await seed(3);
    const published: string[] = [];
    const failing: EventPublisher = {
      publish: (_s, _d, { msgId }) => {
        if (msgId === ids[1]) return Promise.reject(new Error('broker unavailable'));
        published.push(msgId);
        return Promise.resolve();
      },
    };
    const result = await new OutboxRelay(prisma, failing).runOnce();
    expect(result).toEqual({ claimed: 3, published: 1, failed: true });
    expect(published).toEqual([ids[0]]);
    const rows = await prisma.outboxEvent.findMany({ orderBy: { id: 'asc' } });
    expect(rows.map((r) => [r.publishedAt !== null, r.attempts, r.lastError])).toEqual([
      [true, 1, null],
      [false, 1, 'broker unavailable'],
      [false, 0, null],
    ]);
  });
});

describe('outbox relay: sensitive subjects', () => {
  // A test-only sensitive subject, so the check does not depend on billing's real payload.
  const SENSITIVE = 'test.secret.issued';

  it("clears a sensitive row's payload when it is published, and leaves the others", async () => {
    const [plainId, secretId] = [newId(), newId()];
    await prisma.outboxEvent.createMany({
      data: [
        {
          id: plainId,
          subject: 'audit.record',
          payload: { eventId: plainId },
          aggregateId: plainId,
        },
        {
          id: secretId,
          subject: SENSITIVE,
          payload: { eventId: secretId, token: 'raw' },
          aggregateId: secretId,
        },
      ],
    });
    const received = new Map<string, unknown>();
    const publisher: EventPublisher = {
      publish: (_subject, data, { msgId }) => {
        received.set(msgId, JSON.parse(new TextDecoder().decode(data)));
        return Promise.resolve();
      },
    };

    const result = await new OutboxRelay(prisma, publisher, new Set([SENSITIVE])).runOnce();

    expect(result).toEqual({ claimed: 2, published: 2, failed: false });
    expect(received.get(secretId)).toEqual({ eventId: secretId, token: 'raw' }); // the consumer got it all
    const rows = await prisma.outboxEvent.findMany({ orderBy: { id: 'asc' } });
    expect(rows.map((row) => [row.subject, row.payload, row.publishedAt !== null])).toEqual([
      ['audit.record', { eventId: plainId }, true],
      [SENSITIVE, {}, true],
    ]);
  });

  it('keeps a sensitive payload while its publish is still failing', async () => {
    const id = newId();
    await prisma.outboxEvent.create({
      data: { id, subject: SENSITIVE, payload: { eventId: id, token: 'raw' }, aggregateId: id },
    });
    const failing: EventPublisher = { publish: () => Promise.reject(new Error('broker down')) };
    await new OutboxRelay(prisma, failing, new Set([SENSITIVE])).runOnce();
    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id } });
    expect(row.payload).toEqual({ eventId: id, token: 'raw' });
  });
});
