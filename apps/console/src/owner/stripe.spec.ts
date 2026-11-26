import { describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  ownerBillingPortal: vi.fn(() =>
    Promise.resolve({ data: { url: 'https://billing.stripe.test/p' } }),
  ),
}));
vi.mock('@wayfare/api-client', () => api);

const { openPortal } = await import('./stripe');

describe('Stripe’s portal (Y4)', () => {
  it('goes to the session billing made', async () => {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    await openPortal();
    expect(assign).toHaveBeenCalledWith('https://billing.stripe.test/p');
    vi.unstubAllGlobals();
  });
});
