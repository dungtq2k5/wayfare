// The localization consumers, end to end through the test broker: a published ready event opens
// the gate, and the relay publishes the resulting status change.
import {
  CATALOG_PLACE_STATUS_CHANGED,
  NARRATION_LOCALIZATION_READY,
  PlaceStatus,
} from '@wayfare/contracts';
import { localizationReadyFixture } from '@wayfare/contracts/testing';
import { ConsumerRunner, ensureStreams, NatsClient, OutboxRelay } from '@wayfare/nest-common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalizationReadyConsumer } from '../../src/modules/localization-ready/localization-ready.consumer';
import { CATALOG_STREAMS } from '../../src/modules/outbox/outbox.module';
import { testConfig, testPrisma, truncateAll } from '../setup/database';
import { insertPlace, taxonomy } from '../setup/fixtures';
import { catalogServices } from '../setup/services';

/** A durable of its own, reading only new messages, so a running catalog never competes. */
class TestReadyConsumer extends LocalizationReadyConsumer {
  override readonly service = 'catalog-it';
}

const prisma = testPrisma();
const { localizations } = catalogServices(prisma);
const consumer = new TestReadyConsumer(localizations);
let nats: NatsClient;
let runner: ConsumerRunner;
let relay: OutboxRelay;

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

beforeAll(async () => {
  await truncateAll(prisma);
  nats = await NatsClient.connect(testConfig().get('NATS_URL', { infer: true }), 'catalog-it');
  await ensureStreams(nats.jsm, CATALOG_STREAMS);
  await nats.jsm.consumers
    .delete(NARRATION_LOCALIZATION_READY.stream, consumer.durable)
    .catch(() => undefined);
  runner = new ConsumerRunner(nats);
  await runner.start([consumer], { deliverPolicy: 'new' });
  relay = new OutboxRelay(prisma, nats);
});

afterAll(async () => {
  await runner.stop();
  await nats.jsm.consumers
    .delete(NARRATION_LOCALIZATION_READY.stream, consumer.durable)
    .catch(() => undefined);
  await nats.close();
  await prisma.$disconnect();
});

describe('narration.localization.ready over JetStream', () => {
  it('opens the gate, and the relay publishes the status change', async () => {
    const tax = await taxonomy(prisma);
    const place = await insertPlace(prisma, {
      areaId: tax.area.id,
      categoryId: tax.any.id,
      status: PlaceStatus.PROCESSING,
    });
    const payload = localizationReadyFixture({
      placeId: place.id,
      lang: 'en',
      sourceContentHash: place.contentHash,
    });
    await nats.js.publish(NARRATION_LOCALIZATION_READY.subject, JSON.stringify(payload), {
      msgID: payload.eventId,
    });
    const opened = await waitFor(
      () => prisma.place.findUniqueOrThrow({ where: { id: place.id } }),
      (row) => row.status === String(PlaceStatus.ACTIVE),
    );
    expect(opened.status).toBe(PlaceStatus.ACTIVE);
    expect(await prisma.processedEvent.count({ where: { consumer: consumer.durable } })).toBe(1);

    await relay.runOnce();
    const published = await prisma.outboxEvent.findFirstOrThrow({
      where: { subject: CATALOG_PLACE_STATUS_CHANGED.subject },
    });
    expect(published.publishedAt).not.toBeNull();
  });
});
