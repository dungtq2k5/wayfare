import { z } from 'zod';
import { zUuidV7 } from '../common/ids';
import { zSha256Hex } from '../events/event-definition';
import { normalizeText } from '../common/text';
import { MAX_MENU_ITEMS_PER_PLACE } from '../entitlements/ceilings';
import { DISPLAY_PRICE_CEILING_MINOR, MenuCurrency } from '../money/display-price';
import {
  MAX_ADDRESS_LENGTH,
  MAX_ALT_TEXT_LENGTH,
  MAX_DESCRIPTION_CHARS,
  MAX_MENU_ITEM_DESCRIPTION_LENGTH,
  MAX_MENU_ITEM_NAME_LENGTH,
  MAX_OPENING_HOURS_ROWS,
  MAX_PHONE_LENGTH,
  MAX_PLACE_NAME_LENGTH,
  MAX_WEBSITE_URL_LENGTH,
  PRICE_BAND_MAX,
  PRICE_BAND_MIN,
  PUBLIC_CODE_PATTERN,
} from './limits';

/** User text, normalized before its bounds are checked (conventions §11.1). */
const zText = (max: number, options: { singleLine?: boolean } = {}) =>
  z
    .string()
    .transform(normalizeText)
    .pipe(
      options.singleLine === true
        ? z
            .string()
            .min(1)
            .max(max)
            .regex(/^[^\n]*$/)
        : z.string().min(1).max(max),
    );

/** A WGS 84 point (rdm-spec §2.6). Longitude comes second here and first in SQL. */
export const zGeoPoint = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  .strict();
/** A WGS 84 point. */
export type GeoPoint = z.output<typeof zGeoPoint>;

/**
 * A typed code in its canonical form, or null: upper case, dashes dropped, and the look-alikes
 * Crockford maps (`O` → `0`, `I`/`L` → `1`) folded, so a code read off a sticker still resolves.
 */
export function canonicalPublicCode(value: string): string | null {
  const folded = value
    .trim()
    .toUpperCase()
    // FIXME Prefer `String#replaceAll()` over `String#replace()`.
    .replace(/-/g, '')
    // FIXME Prefer `String#replaceAll()` over `String#replace()`.
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  return PUBLIC_CODE_PATTERN.test(folded) ? folded : null;
}

/** A Place's printed code (rdm-spec C-1), canonicalized: eight Crockford base32 characters. */
export const zPublicCode = z
  .string()
  .max(16)
  .transform((value, ctx) => {
    const code = canonicalPublicCode(value);
    if (code === null) {
      ctx.addIssue({ code: 'custom', message: 'Expected a public code' });
      return z.NEVER;
    }
    return code;
  });

/** A local business time, `HH:MM` (rdm-spec C-16). */
export const zLocalTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Expected HH:MM' });

/**
 * One opening-hours row (rdm-spec C-16): exactly one of `weekday` and `specificDate`, and both
 * times unless the row says closed. A `closesAt` before `opensAt` ends the next day.
 */
export const zOpeningHoursRow = z
  .object({
    weekday: z.number().int().min(1).max(7).optional(),
    specificDate: z.iso.date().optional(),
    opensAt: zLocalTime.optional(),
    closesAt: zLocalTime.optional(),
    isClosed: z.boolean().default(false),
  })
  .strict()
  .superRefine((row, ctx) => {
    if ((row.weekday === undefined) === (row.specificDate === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['weekday'],
        message: 'Exactly one of weekday and specificDate',
      });
    }
    if (!row.isClosed) {
      for (const key of ['opensAt', 'closesAt'] as const) {
        if (row[key] === undefined) {
          ctx.addIssue({ code: 'custom', path: [key], message: 'Required unless closed' });
        }
      }
    }
  });
/** One opening-hours row. */
export type OpeningHoursRow = z.output<typeof zOpeningHoursRow>;

/** A whole opening-hours list, replaced at once. */
export const zOpeningHours = z.array(zOpeningHoursRow).max(MAX_OPENING_HOURS_ROWS);

/** One stored WebP variant (rdm-spec C-5). */
export const zPhotoVariant = z
  .object({
    objectPath: z.string().min(1).max(512),
    sha256: zSha256Hex,
    bytes: z.number().int().min(1),
    width: z.number().int().min(1),
    height: z.number().int().min(1),
  })
  .strict();
/** One stored WebP variant. */
export type PhotoVariant = z.output<typeof zPhotoVariant>;

/** `PhotoVariants` — the JSONB of rdm-spec C-5 and C-12, owned here (rdm-spec §2.5). */
export const zPhotoVariants = z
  .object({ thumb: zPhotoVariant, card: zPhotoVariant, full: zPhotoVariant })
  .strict();
/** A photo's three variants. */
export type PhotoVariants = z.output<typeof zPhotoVariants>;

/** An E.164 phone number. */
export const zPhone = z
  .string()
  .max(MAX_PHONE_LENGTH)
  .regex(/^\+[1-9]\d{6,14}$/, { message: 'Expected E.164' });

/** A venue's website: `https` only (rdm-spec C-1). */
export const zWebsiteUrl = z.url({ protocol: /^https$/ }).max(MAX_WEBSITE_URL_LENGTH);

/** A price band, `$` to `$$$$` (rdm-spec C-1). */
export const zPriceBand = z.number().int().min(PRICE_BAND_MIN).max(PRICE_BAND_MAX);

/** A category code (rdm-spec C-2). */
export const zCategoryCode = z.string().regex(/^[A-Z][A-Z0-9_]{0,31}$/);

/**
 * The content fields shared by admin create, admin edit and the owner submission payload.
 * **No `narrationPriority` and no `triggerRadiusM`** (rdm-spec §1.4): an owner request carrying
 * them is refused, not ignored. `null` clears an optional field.
 */
export const zPlaceContentInput = z
  .object({
    nameVi: zText(MAX_PLACE_NAME_LENGTH, { singleLine: true }),
    descriptionVi: zText(MAX_DESCRIPTION_CHARS),
    categoryCode: zCategoryCode,
    location: zGeoPoint,
    addressVi: zText(MAX_ADDRESS_LENGTH, { singleLine: true }).nullable().optional(),
    priceBand: zPriceBand.nullable().optional(),
    phone: zPhone.nullable().optional(),
    websiteUrl: zWebsiteUrl.nullable().optional(),
  })
  .strict();
/** Validated Place content. */
export type PlaceContentInput = z.output<typeof zPlaceContentInput>;

/** One photo of a replaced set: an existing photo kept, or a confirmed upload added. */
export const zPhotoSetItem = z
  .object({
    photoId: zUuidV7.optional(),
    uploadId: zUuidV7.optional(),
    altTextVi: zText(MAX_ALT_TEXT_LENGTH, { singleLine: true }).nullable().optional(),
  })
  .strict()
  .refine((item) => (item.photoId === undefined) !== (item.uploadId === undefined), {
    message: 'Exactly one of photoId and uploadId',
    path: ['photoId'],
  });

/** One menu line (rdm-spec C-6). Its price is in the menu's currency, checked with the menu. */
export const zMenuItemInput = z
  .object({
    nameVi: zText(MAX_MENU_ITEM_NAME_LENGTH, { singleLine: true }),
    descriptionVi: zText(MAX_MENU_ITEM_DESCRIPTION_LENGTH).nullable().optional(),
    priceMinor: z.number().int().min(0).nullable().optional(),
    isAvailable: z.boolean().default(true),
  })
  .strict();
/** One validated menu line. */
export type MenuItemInput = z.output<typeof zMenuItemInput>;

/** Every price of a menu within its currency's ceiling (ADR 0046). */
export function checkMenuPrices(
  menu: {
    readonly menuCurrency: MenuCurrency;
    readonly items: readonly { priceMinor?: number | null }[];
  },
  ctx: z.RefinementCtx,
): void {
  const ceiling = DISPLAY_PRICE_CEILING_MINOR[menu.menuCurrency];
  menu.items.forEach((item, index) => {
    if (item.priceMinor != null && item.priceMinor > ceiling) {
      ctx.addIssue({
        code: 'too_big',
        origin: 'number',
        maximum: ceiling,
        inclusive: true,
        path: ['items', index, 'priceMinor'],
        message: 'Above the currency ceiling',
      });
    }
  });
}

/** A whole menu: one currency, every price within its ceiling (rdm-spec C-6, ADR 0046). */
export const zMenuInput = z
  .object({
    menuCurrency: z.enum(MenuCurrency),
    items: z.array(zMenuItemInput).max(MAX_MENU_ITEMS_PER_PLACE),
  })
  .strict()
  .superRefine(checkMenuPrices);
/** A validated menu. */
export type MenuInput = z.output<typeof zMenuInput>;
