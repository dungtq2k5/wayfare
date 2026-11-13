import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  newId,
} from '@wayfare/contracts';
import type { AuditRecordPayload } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { PoisonMessage } from '../errors/poison-message';
import {
  DLQ_HEADERS,
  handleMessage,
  JetStreamConsumer,
  MAX_DELIVER,
  NAK_DELAYS_MS,
} from './consumer.runner';
import type { DeadLetterPublisher, RunnerMessage } from './consumer.runner';

class RecordingConsumer extends JetStreamConsumer<typeof AUDIT_RECORD> {
  readonly event = AUDIT_RECORD;
  readonly service = 'identity';
  readonly seen: AuditRecordPayload[] = [];

  constructor(private readonly behaviour: () => void = () => undefined) {
    super();
  }

  handle(payload: AuditRecordPayload): Promise<void> {
    this.seen.push(payload);
    this.behaviour();
    return Promise.resolve();
  }
}

class Headers {
  private readonly map = new Map<string, string>();
  constructor(entries: Record<string, string>) {
    for (const [k, v] of Object.entries(entries)) this.map.set(k, v);
  }
  get(key: string): string {
    return this.map.get(key) ?? '';
  }
  set(key: string, value: string): void {
    this.map.set(key, value);
  }
  keys(): string[] {
    return [...this.map.keys()];
  }
}

interface FakeMessage extends RunnerMessage {
  outcome: string[];
}

function message(
  body: unknown,
  opts: { msgId?: string; deliveryCount?: number } = {},
): FakeMessage {
  const outcome: string[] = [];
  return {
    outcome,
    subject: 'audit.record',
    data: new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)),
    headers: new Headers({
      'Nats-Msg-Id': opts.msgId ?? newId(),
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
    }),
    info: { deliveryCount: opts.deliveryCount ?? 1 },
    ack: () => outcome.push('ack'),
    nak: (ms?: number) => outcome.push(`nak:${ms}`),
    term: () => outcome.push('term'),
  };
}

class FakeDlq implements DeadLetterPublisher {
  readonly letters: { subject: string; headers: Record<string, string> }[] = [];
  constructor(private readonly fail = false) {}
  publish(
    subject: string,
    _data: Uint8Array,
    options: { headers: Record<string, string> },
  ): Promise<void> {
    if (this.fail) return Promise.reject(new Error('nats down'));
    this.letters.push({ subject, headers: options.headers });
    return Promise.resolve();
  }
}

const silent = { warn: () => undefined, error: () => undefined };
const deviceId = newId();
const valid = {
  eventId: newId(),
  occurredAt: '2026-09-16T12:00:00.000Z',
  service: 'identity',
  actor: { type: AuditActorType.DEVICE, deviceId },
  action: AuditAction.DEVICE_REGISTERED,
  resource: { type: AuditResourceType.DEVICE, id: deviceId },
  metadata: {},
};

describe('handleMessage — the three outcomes', () => {
  it('acks a message the handler applied', async () => {
    const consumer = new RecordingConsumer();
    const msg = message(valid);
    expect(await handleMessage(consumer, msg, new FakeDlq(), silent)).toBe('acked');
    expect(msg.outcome).toEqual(['ack']);
    expect(consumer.seen[0]?.eventId).toBe(valid.eventId);
  });

  it('naks a TRANSIENT failure with the runner-side delay for that attempt', async () => {
    const consumer = new RecordingConsumer(() => {
      throw new Error('deadlock');
    });
    const first = message(valid, { deliveryCount: 1 });
    const third = message(valid, { deliveryCount: 3 });
    expect(await handleMessage(consumer, first, new FakeDlq(), silent)).toBe('nacked');
    await handleMessage(consumer, third, new FakeDlq(), silent);
    expect(first.outcome).toEqual([`nak:${NAK_DELAYS_MS[0]}`]);
    expect(third.outcome).toEqual([`nak:${NAK_DELAYS_MS[2]}`]);
  });

  it('dead-letters and terms a PoisonMessage', async () => {
    const consumer = new RecordingConsumer(() => {
      throw new PoisonMessage('references nothing');
    });
    const dlq = new FakeDlq();
    const msg = message(valid);
    expect(await handleMessage(consumer, msg, dlq, silent)).toBe('dead-lettered');
    expect(msg.outcome).toEqual(['term']);
    expect(dlq.letters[0]?.subject).toBe('dlq.identity.identity-audit-record');
    expect(dlq.letters[0]?.headers[DLQ_HEADERS.error]).toBe('references nothing');
    expect(dlq.letters[0]?.headers.traceparent).toBeDefined();
    expect(dlq.letters[0]?.headers['Nats-Msg-Id']).toBeUndefined(); // kept under its own name
  });

  it('dead-letters a transient failure on the FINAL permitted delivery', async () => {
    const consumer = new RecordingConsumer(() => {
      throw new Error('still down');
    });
    const dlq = new FakeDlq();
    const msg = message(valid, { deliveryCount: MAX_DELIVER });
    expect(await handleMessage(consumer, msg, dlq, silent)).toBe('dead-lettered');
    expect(dlq.letters[0]?.headers[DLQ_HEADERS.deliveryCount]).toBe(String(MAX_DELIVER));
  });

  it('never terms a message whose dead letter could not be written', async () => {
    const consumer = new RecordingConsumer(() => {
      throw new PoisonMessage('bad');
    });
    const msg = message(valid);
    expect(await handleMessage(consumer, msg, new FakeDlq(true), silent)).toBe('nacked');
    expect(msg.outcome).toEqual([`nak:${NAK_DELAYS_MS[0]}`]);
  });
});

describe('handleMessage — poison detection before the handler runs', () => {
  it.each([
    ['a payload failing its schema', message({ ...valid, action: 'NOT_AN_ACTION' })],
    ['a body that is not JSON', message('{not json')],
    ['a v4 Nats-Msg-Id', message(valid, { msgId: '0d5f2c1e-8b2a-4f3e-9c1d-2a3b4c5d6e7f' })],
  ])('dead-letters %s', async (_label, msg) => {
    const consumer = new RecordingConsumer();
    expect(await handleMessage(consumer, msg, new FakeDlq(), silent)).toBe('dead-lettered');
    expect(consumer.seen).toHaveLength(0);
  });

  it('accepts a replay whose header differs from payload.eventId', async () => {
    const consumer = new RecordingConsumer();
    const msg = message(valid, { msgId: newId() });
    expect(await handleMessage(consumer, msg, new FakeDlq(), silent)).toBe('acked');
  });
});
