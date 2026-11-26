import { describe, expect, it, vi } from 'vitest';
import { BILLING_EVENTS_PRUNE_BATCH, BillingEventsPruneJob } from './billing-events-prune.job';

const NOW = new Date('2026-11-21T00:00:00Z');

describe('the billing events prune', () => {
  it('deletes in batches until a batch comes back short', async () => {
    const prisma = {
      $executeRaw: vi
        .fn()
        .mockResolvedValueOnce(BILLING_EVENTS_PRUNE_BATCH)
        .mockResolvedValueOnce(3),
    };
    await expect(new BillingEventsPruneJob(prisma as never).run(NOW)).resolves.toEqual({
      deleted: BILLING_EVENTS_PRUNE_BATCH + 3,
    });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
  });
});
