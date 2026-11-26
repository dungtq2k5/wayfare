import { FREE_PLAN_GRANTS, SubscriptionStatus } from '@wayfare/contracts';
import { describe, expect, it, vi } from 'vitest';
import { EntitlementsService } from './entitlements.service';

const free = { id: 'free', code: 'FREE', name: 'Free', ...FREE_PLAN_GRANTS };
const service = new EntitlementsService({} as never, {} as never, {} as never);
const db = (plan: unknown, price: unknown = null) => ({
  plan: { findFirst: vi.fn(() => Promise.resolve(plan)) },
  planPrice: { findUnique: vi.fn(() => Promise.resolve(price)) },
});
const account = (planPriceId: string | null) =>
  ({ planPriceId, subscriptionStatus: SubscriptionStatus.ACTIVE }) as never;

describe('deriving an account’s grants (rdm-spec B-3)', () => {
  it('falls back to Free when the subscribed price no longer exists', async () => {
    await expect(service.derive(db(free) as never, account('gone'))).resolves.toEqual({
      effectivePlanId: 'free',
      next: FREE_PLAN_GRANTS,
    });
  });

  it('refuses to derive anything without the seeded FREE plan', async () => {
    await expect(service.derive(db(null) as never, account(null))).rejects.toThrow(
      'The FREE plan is missing',
    );
  });
});
