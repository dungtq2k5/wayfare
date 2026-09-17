import { describe, expect, expectTypeOf, it } from 'vitest';
import { displayPrice, MenuCurrency, zDisplayPrice } from './display-price';
import type { DisplayPrice } from './display-price';
import { applyBasisPoints, BPS_DENOMINATOR, splitVoucherSale } from './fees';
import {
  addMoney,
  CurrencyCode,
  MAX_AMOUNT_MINOR,
  money,
  MoneyError,
  multiplyMoney,
  subtractMoney,
  zMoney,
} from './money';
import type { Money } from './money';

const usd = (amountMinor: number): Money => money(amountMinor, CurrencyCode.USD);

describe('money: basis points round half up, once', () => {
  it.each([
    ['below .5', 101, 1500, 15],
    ['above .5', 333, 1500, 50],
    ['exactly .5 rounds up', 5, 1000, 1],
    ['zero commission', 999, 0, 0],
  ])('%s', (_label, amount, bps, expected) => {
    expect(applyBasisPoints(usd(amount), bps)).toEqual(usd(expected));
  });

  it('is exact for the largest input', () => {
    expect(applyBasisPoints(usd(MAX_AMOUNT_MINOR), BPS_DENOMINATOR)).toEqual(usd(MAX_AMOUNT_MINOR));
    expect(MAX_AMOUNT_MINOR * BPS_DENOMINATOR).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});

describe('money: splitVoucherSale', () => {
  it('rounds once, on the total — never per unit', () => {
    // Per unit: 46.5 → 47, × 3 = 141. On the total: 139.5 → 140. (The same holds for $1.10 × 3 —
    // 50, not 51 — but a voucher that cheap is refused.)
    const split = splitVoucherSale(usd(310), 3, 1500);
    expect(split).toEqual({ total: usd(930), applicationFee: usd(140), venueAmount: usd(790) });
    expect(applyBasisPoints(usd(310), 1500).amountMinor * 3).toBe(141);
    expect(applyBasisPoints(usd(330), 1500)).toEqual(usd(50));
  });

  it('applies the Pro rate', () => {
    expect(splitVoucherSale(usd(1000), 1, 1000)).toEqual({
      total: usd(1000),
      applicationFee: usd(100),
      venueAmount: usd(900),
    });
  });

  it('gives the venue the whole total at zero commission', () => {
    const split = splitVoucherSale(usd(500), 2, 0);
    expect(split.applicationFee).toEqual(usd(0));
    expect(split.venueAmount).toEqual(split.total);
  });
});

describe('money: refusals', () => {
  it.each([
    ['a float', () => usd(1.5)],
    ['a negative', () => usd(-1)],
    ['an amount above the column', () => usd(MAX_AMOUNT_MINOR + 1)],
    ['bps above the denominator', () => applyBasisPoints(usd(100), 10_001)],
    ['fractional bps', () => applyBasisPoints(usd(100), 1.5)],
    ['a voucher below the minimum price', () => splitVoucherSale(usd(299), 1, 1000)],
    ['a commission above the cap', () => splitVoucherSale(usd(300), 1, 3001)],
    ['a fractional quantity', () => multiplyMoney(usd(300), 1.5)],
    ['a negative result', () => subtractMoney(usd(1), usd(2))],
    ['an overflowing sum', () => addMoney(usd(MAX_AMOUNT_MINOR), usd(1))],
    [
      'different currencies',
      () => addMoney(usd(1), { amountMinor: 1, currency: 'VND' as CurrencyCode }),
    ],
  ])('refuses %s', (_label, run) => {
    expect(run).toThrow(MoneyError);
  });

  it('zMoney is strict and integer', () => {
    expect(zMoney.safeParse({ amountMinor: 1, currency: 'USD' }).success).toBe(true);
    expect(zMoney.safeParse({ amountMinor: 1.5, currency: 'USD' }).success).toBe(false);
    expect(zMoney.safeParse({ amountMinor: 1, currency: 'VND' }).success).toBe(false);
    expect(zMoney.safeParse({ amountMinor: 1, currency: 'USD', extra: true }).success).toBe(false);
  });
});

describe('money: display prices', () => {
  it('are not Money, even in USD', () => {
    const price = displayPrice(500, MenuCurrency.USD);
    expectTypeOf<DisplayPrice>().not.toExtend<Money>();
    // @ts-expect-error — a display price never reaches a charging path (ADR 0046).
    addMoney(price, usd(1));
  });

  it('refuse an amount above the currency ceiling', () => {
    expect(displayPrice(100_000_000, MenuCurrency.VND).amountMinor).toBe(100_000_000);
    expect(() => displayPrice(100_000_001, MenuCurrency.VND)).toThrow(RangeError);
    expect(() => displayPrice(100_001, MenuCurrency.USD)).toThrow(RangeError);
    expect(() => displayPrice(1.5, MenuCurrency.USD)).toThrow(RangeError);
  });

  it('brand on parse and apply the ceiling', () => {
    expect(zDisplayPrice.parse({ amountMinor: 45_000, currency: 'VND' })).toEqual({
      amountMinor: 45_000,
      currency: 'VND',
    });
    expect(zDisplayPrice.safeParse({ amountMinor: 100_001, currency: 'USD' }).success).toBe(false);
  });
});
