// The webhook queue against the real Redis: an attempt's id is one BullMQ accepts, and `has` finds
// it by event, whichever attempt it is.
import { newId } from '@wayfare/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import { WebhookQueue } from '../../src/modules/webhook-queue/webhook-queue.module';
import { testConfig } from '../setup/database';

const queue = new WebhookQueue(testConfig(), { worker: false });
afterAll(() => queue.onApplicationShutdown());

describe('WebhookQueue', () => {
  it('queues an attempt and finds it by event', async () => {
    const billingEventId = newId();
    await queue.add({ billingEventId, attempt: 2 }, 60_000);
    expect(await queue.has(billingEventId, 3)).toBe(true);
    expect(await queue.has(newId(), 3)).toBe(false);
  });
});
