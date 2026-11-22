import { describe, expect, it, vi } from 'vitest';
import { BillingWebhooksRecoverJob } from './billing-webhooks-recover.job';

const NOW = new Date('2026-11-21T00:00:00Z');

describe('the webhook recovery sweep (rdm-spec B-4)', () => {
  function job(runsWorker: boolean, rows: { id: string }[] = []) {
    const prisma = { billingEvent: { findMany: vi.fn(() => Promise.resolve(rows)) } };
    const queue = { runsWorker, has: vi.fn((id: string) => Promise.resolve(id === 'queued')) };
    const webhooks = { enqueue: vi.fn(() => Promise.resolve()) };
    return {
      prisma,
      webhooks,
      job: new BillingWebhooksRecoverJob(prisma as never, queue as never, webhooks as never),
    };
  }

  it('re-adds only the received events whose queue item is gone', async () => {
    const { job: sweep, webhooks } = job(true, [{ id: 'queued' }, { id: 'lost' }]);
    await expect(sweep.run(NOW)).resolves.toEqual({ readded: 1 });
    expect(webhooks.enqueue).toHaveBeenCalledWith({ billingEventId: 'lost', attempt: 1 });
  });

  it('sweeps at boot only in the worker process, and a failed boot sweep is logged, not thrown', async () => {
    const idle = job(false);
    await idle.job.onApplicationBootstrap();
    expect(idle.prisma.billingEvent.findMany).not.toHaveBeenCalled();
    for (const failure of [new Error('db down'), 'db down']) {
      const broken = job(true);
      broken.prisma.billingEvent.findMany.mockRejectedValueOnce(failure);
      await expect(broken.job.onApplicationBootstrap()).resolves.toBeUndefined();
    }
  });
});
