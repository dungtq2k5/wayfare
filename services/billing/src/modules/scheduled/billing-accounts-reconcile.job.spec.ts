import { describe, expect, it, vi } from 'vitest';
import { BillingAccountsReconcileJob } from './billing-accounts-reconcile.job';

const NOW = new Date('2026-11-21T00:00:00Z');

describe('the owner accounts reconcile (rdm-spec B-3)', () => {
  function job(runsWorker: boolean) {
    const identity = { listVerifiedOwnerIds: vi.fn() };
    const prisma = { $transaction: vi.fn((run: (tx: unknown) => unknown) => run('tx')) };
    const entitlements = {
      openFreeAccount: vi.fn((_tx: unknown, owner: string) => Promise.resolve(owner !== 'had')),
    };
    return {
      identity,
      job: new BillingAccountsReconcileJob(
        prisma as never,
        identity as never,
        entitlements as never,
        { runsWorker } as never,
      ),
    };
  }

  it('pages every verified owner, counting only the accounts it opened', async () => {
    const { job: reconcile, identity } = job(true);
    identity.listVerifiedOwnerIds
      .mockResolvedValueOnce({ ownerUserIds: ['u1', 'had'], page: { nextCursor: 'c2' } })
      .mockResolvedValueOnce({ ownerUserIds: ['u2'], page: { nextCursor: null } });
    await expect(reconcile.run(NOW)).resolves.toEqual({ opened: 2 });
    expect(identity.listVerifiedOwnerIds.mock.calls).toEqual([
      [{ cursor: undefined, limit: 100 }],
      [{ cursor: 'c2', limit: 100 }],
    ]);
  });

  it('reconciles at boot only in the worker process, and a failed boot run is logged, not thrown', async () => {
    const idle = job(false);
    await idle.job.onApplicationBootstrap();
    expect(idle.identity.listVerifiedOwnerIds).not.toHaveBeenCalled();
    for (const failure of [new Error('identity down'), 'identity down']) {
      const broken = job(true);
      broken.identity.listVerifiedOwnerIds.mockRejectedValueOnce(failure);
      await expect(broken.job.onApplicationBootstrap()).resolves.toBeUndefined();
    }
    const pageless = job(true);
    pageless.identity.listVerifiedOwnerIds.mockResolvedValueOnce({ ownerUserIds: [] });
    await expect(pageless.job.run(NOW)).resolves.toEqual({ opened: 0 });
  });
});
