import { z } from 'zod';

/** The currencies money moves in — USD only (ADR 0004, rdm-spec §1.9 CHECK). */
export enum CurrencyCode {
  USD = 'USD',
}

/** Every `CurrencyCode` value. */
export const CURRENCY_CODES = Object.values(CurrencyCode);

/** The largest amount a single `_minor` INTEGER column holds (rdm-spec §1.9). */
export const MAX_AMOUNT_MINOR = 2_147_483_647;

/** Money that moves through Wayfare — charged, refunded or paid out (rdm-spec §1.9). */
export interface Money {
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
}

/** A money operation given operands it must never see — a programming error, never a client error. */
export class MoneyError extends Error {
  constructor(
    message: string,
    readonly operands: readonly unknown[],
  ) {
    super(`${message}: ${JSON.stringify(operands)}`);
    this.name = 'MoneyError';
  }
}

function assertAmount(amountMinor: number, operands: readonly unknown[]): void {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0 || amountMinor > MAX_AMOUNT_MINOR) {
    throw new MoneyError(`Amount must be an integer from 0 to ${MAX_AMOUNT_MINOR}`, operands);
  }
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new MoneyError('Currencies differ', [a, b]);
}

/** Builds a `Money`, checking the amount is a whole number of minor units within bounds. */
export function money(amountMinor: number, currency: CurrencyCode): Money {
  assertAmount(amountMinor, [amountMinor, currency]);
  if (!CURRENCY_CODES.includes(currency)) throw new MoneyError('Unknown currency', [currency]);
  return { amountMinor, currency };
}

/** `a + b`, in one currency. */
export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  const amountMinor = a.amountMinor + b.amountMinor;
  assertAmount(amountMinor, [a, b]);
  return { amountMinor, currency: a.currency };
}

/** `a - b`, in one currency; never negative. */
export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  const amountMinor = a.amountMinor - b.amountMinor;
  assertAmount(amountMinor, [a, b]);
  return { amountMinor, currency: a.currency };
}

/** `unit × quantity`, for a whole, non-negative quantity. */
export function multiplyMoney(unit: Money, quantity: number): Money {
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new MoneyError('Quantity must be a non-negative integer', [unit, quantity]);
  }
  const amountMinor = unit.amountMinor * quantity;
  assertAmount(amountMinor, [unit, quantity]);
  return { amountMinor, currency: unit.currency };
}

/** `Money` on the wire — an event payload or a response DTO. */
export const zMoney: z.ZodType<Money> = z
  .object({
    amountMinor: z.number().int().min(0).max(MAX_AMOUNT_MINOR),
    currency: z.enum(CurrencyCode),
  })
  .strict();
