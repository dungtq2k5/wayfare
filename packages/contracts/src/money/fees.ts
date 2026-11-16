import { money, MoneyError, multiplyMoney, subtractMoney } from './money';
import type { Money } from './money';

/** Basis points in one whole (rdm-spec §1.9). */
export const BPS_DENOMINATOR = 10_000;

/** The largest voucher commission a plan may grant (rdm-spec B-1 CHECK). */
export const MAX_VOUCHER_COMMISSION_BPS = 3_000;

/** The cheapest voucher an offer may sell, so fees never exceed the price (rdm-spec B-7, ADR 0005). */
export const MIN_VOUCHER_PRICE_MINOR = 300;

/**
 * `bps` of an amount, rounded half up, once (rdm-spec §1.9). The product stays below 2^53 for every
 * legal input — `MAX_AMOUNT_MINOR × BPS_DENOMINATOR` is about 2^44 — so nothing is lost.
 */
export function applyBasisPoints(amount: Money, bps: number): Money {
  if (!Number.isInteger(bps) || bps < 0 || bps > BPS_DENOMINATOR) {
    throw new MoneyError(`Basis points must be an integer from 0 to ${BPS_DENOMINATOR}`, [
      amount,
      bps,
    ]);
  }
  const amountMinor = Math.floor(
    (amount.amountMinor * bps + BPS_DENOMINATOR / 2) / BPS_DENOMINATOR,
  );
  return money(amountMinor, amount.currency);
}

/** A voucher sale's split (ADR 0005). */
export interface VoucherSaleSplit {
  readonly total: Money;
  /** The platform's application fee. */
  readonly applicationFee: Money;
  /** What the venue receives, before Stripe's processing fee. */
  readonly venueAmount: Money;
}

/**
 * Splits a voucher sale: multiply first, take the commission once on the total, then subtract —
 * never per unit (rdm-spec §1.9, ADR 0005).
 */
export function splitVoucherSale(
  unitPrice: Money,
  quantity: number,
  commissionBps: number,
): VoucherSaleSplit {
  if (unitPrice.amountMinor < MIN_VOUCHER_PRICE_MINOR) {
    throw new MoneyError(`A voucher costs at least ${MIN_VOUCHER_PRICE_MINOR}`, [unitPrice]);
  }
  if (commissionBps > MAX_VOUCHER_COMMISSION_BPS) {
    throw new MoneyError(`Commission is at most ${MAX_VOUCHER_COMMISSION_BPS} bps`, [
      commissionBps,
    ]);
  }
  const total = multiplyMoney(unitPrice, quantity);
  const applicationFee = applyBasisPoints(total, commissionBps);
  return { total, applicationFee, venueAmount: subtractMoney(total, applicationFee) };
}
