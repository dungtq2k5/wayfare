import { z } from 'zod';

declare const displayOnly: unique symbol;

/** The one currency of a Place's whole menu — rdm-spec C-1 `menu_currency` (ADR 0046). */
export enum MenuCurrency {
  VND = 'VND',
  USD = 'USD',
}

/** Every `MenuCurrency` value. */
export const MENU_CURRENCIES = Object.values(MenuCurrency);

/**
 * A price shown, never charged (ADR 0046). The brand keeps it out of every `Money` parameter,
 * even when its currency is USD.
 */
export interface DisplayPrice {
  readonly amountMinor: number;
  readonly currency: MenuCurrency;
  readonly [displayOnly]: true;
}

/**
 * Per-currency sanity ceilings — above them is a typo, not a price (rdm-spec C-6, ADR 0046).
 * ₫50 M and $2 000.
 */
export const DISPLAY_PRICE_CEILING_MINOR: Readonly<Record<MenuCurrency, number>> = {
  [MenuCurrency.VND]: 50_000_000,
  [MenuCurrency.USD]: 200_000,
};

function isValidDisplayAmount(amountMinor: number, currency: MenuCurrency): boolean {
  return (
    Number.isSafeInteger(amountMinor) &&
    amountMinor >= 0 &&
    amountMinor <= DISPLAY_PRICE_CEILING_MINOR[currency]
  );
}

/** Builds a `DisplayPrice`, throwing a `RangeError` for an amount outside its currency's ceiling. */
export function displayPrice(amountMinor: number, currency: MenuCurrency): DisplayPrice {
  if (!MENU_CURRENCIES.includes(currency))
    throw new RangeError(`Unknown menu currency ${String(currency)}`);
  if (!isValidDisplayAmount(amountMinor, currency)) {
    throw new RangeError(
      `Display price ${amountMinor} ${currency} is outside 0..${DISPLAY_PRICE_CEILING_MINOR[currency]}`,
    );
  }
  return { amountMinor, currency } as DisplayPrice;
}

/** A display price on the wire; branded on parse. */
export const zDisplayPrice: z.ZodType<DisplayPrice> = z
  .object({
    amountMinor: z.number().int().min(0),
    currency: z.enum(MenuCurrency),
  })
  .strict()
  .refine((value) => isValidDisplayAmount(value.amountMinor, value.currency), {
    message: 'Above the currency ceiling',
    path: ['amountMinor'],
  })
  .transform((value) => value as DisplayPrice);
