import { describe, expect, it } from 'vitest';
import { money } from './money';

describe('a price as Stripe states it', () => {
  it('writes đồng in Vietnam’s own form, in either language', () => {
    expect(money({ amountMinor: 199_000, currency: 'vnd' }, 'en')).toBe('199.000 ₫');
    expect(money({ amountMinor: 199_000, currency: 'VND' }, 'vi')).toBe('199.000 ₫');
  });

  it('writes any other currency from its minor units, in the page’s language', () => {
    expect(money({ amountMinor: 900, currency: 'usd' }, 'en')).toBe('$9.00');
    expect(money({ amountMinor: 900, currency: 'USD' }, 'vi')).toBe('9,00\u00a0US$');
  });
});
