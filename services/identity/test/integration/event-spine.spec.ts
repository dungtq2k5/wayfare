import { headers } from '@nats-io/transport-node';
import { AUDIT_RECORD, dlqSubject, newId } from '@wayfare/contracts';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { ConsumerRunner, ensureStreams, NatsClient, OutboxRelay } from '@wayfare/nest-common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditConsumer } from '../../src/modules/audit/audit.consumer';
import { AuditService } from '../../src/modules/audit/audit.service';
import { IDENTITY_STREAMS } from '../../src/modules/outbox/outbox.module';
import { testConfig, testPrisma, truncateAll } from '../setup/database';
import { identityServices } from '../setup/services';

/**
 * A durable of its own, reading only NEW messages. The suite runs against the separate test
 * broker (NATS_URL_TEST), so its events never reach a running identity.
 */
class TestAuditConsumer extends AuditConsumer {
  override readonly service = 'identity-it';
}

const prisma = testPrisma();
const config = testConfig();
let nats: NatsClient;
let runner: ConsumerRunner;
const consumer = new TestAuditConsumer(new AuditService(prisma));
const { devices } = identityServices(prisma);
const deadLetters = dlqSubject(consumer.service, consumer.durable);

async function waitFor<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function consumerIdle(): Promise<void> {
  await waitFor(
    () => nats.jsm.consumers.info(AUDIT_RECORD.stream, consumer.durable),
    (info) => info.num_pending === 0 && info.num_ack_pending === 0,
  );
}

async function dlqCount(): Promise<number> {
  const info = await nats.jsm.streams.info('DLQ', { subjects_filter: deadLetters });
  return info.state.subjects?.[deadLetters] ?? 0;
}

beforeAll(async () => {
  nats = await NatsClient.connect(config.get('NATS_URL', { infer: true }), 'identity-it');
  await ensureStreams(nats.jsm, IDENTITY_STREAMS);
  await nats.jsm.consumers.delete(AUDIT_RECORD.stream, consumer.durable).catch(() => undefined);
  runner = new ConsumerRunner(nats);
  await runner.start([consumer], { deliverPolicy: 'new' });
});

afterAll(async () => {
  await runner.stop();
  await nats.jsm.consumers.delete(AUDIT_RECORD.stream, consumer.durable).catch(() => undefined);
  await nats.close();
  await prisma.$disconnect();
});

beforeEach(() => truncateAll(prisma));

describe('outbox → JetStream → audit_logs', () => {
  it('delivers a registration into audit_logs, and absorbs a REPLAY under a new message id', async () => {
    const { deviceId } = await devices.registerDevice(
      {
        platform: identityGrpc.Platform.PLATFORM_ANDROID,
        appVersion: '0.1.0',
        contentLocale: 'en',
        privacyPolicyVersion: '2026-09-01',
      },
      { kind: 'anonymous', origin: { ip: '203.0.113.9', userAgent: 'it/1.0' } },
    );
    const [event] = await prisma.outboxEvent.findMany();

    expect(await new OutboxRelay(prisma, nats).runOnce()).toMatchObject({
      published: 1,
      failed: false,
    });
    const row = await waitFor(
      () => prisma.auditLog.findUnique({ where: { eventId: event!.id } }),
      (found) => found !== null,
    );
    expect(row).toMatchObject({
      action: 'DEVICE_REGISTERED',
      resourceType: 'DEVICE',
      resourceId: deviceId,
      actorDeviceId: deviceId,
    });

    // The redelivery proof: the same payload under a NEW, valid UUIDv7 header — the broker does
    // not dedupe it, so the consumer genuinely receives it twice.
    const dlqBefore = await dlqCount();
    const replayId = newId();
    const bag = headers();
    bag.set('Nats-Msg-Id', replayId);
    await nats.js.publish(
      AUDIT_RECORD.subject,
      new TextEncoder().encode(JSON.stringify(event!.payload)),
      {
        msgID: replayId,
        headers: bag,
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    await consumerIdle();

    expect(await prisma.auditLog.count({ where: { eventId: event!.id } })).toBe(1);
    expect(await dlqCount()).toBe(dlqBefore); // absorbed, not rejected
  });

  it('dead-letters a payload that fails its schema, writing nothing', async () => {
    const dlqBefore = await dlqCount();
    const id = newId();
    const bag = headers();
    bag.set('Nats-Msg-Id', id);
    await nats.js.publish(AUDIT_RECORD.subject, new TextEncoder().encode('{"eventId":"nope"}'), {
      msgID: id,
      headers: bag,
    });
    await waitFor(dlqCount, (count) => count > dlqBefore);
    expect(await dlqCount()).toBe(dlqBefore + 1);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('re-verifies existing streams without changing them (create-or-verify is idempotent)', async () => {
    await expect(ensureStreams(nats.jsm, IDENTITY_STREAMS)).resolves.toBeUndefined();
  });
});
