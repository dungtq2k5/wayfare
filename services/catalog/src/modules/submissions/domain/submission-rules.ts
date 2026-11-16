import { effectiveLimit } from '@wayfare/contracts';
import type { Entitlements, PlaceSubmissionPayload } from '@wayfare/contracts';

/** A limit a payload goes past: which, and the effective value (rdm-spec C-5, C-6). */
export type PayloadLimitBreach =
  | { readonly code: 'PHOTO_LIMIT_REACHED'; readonly limit: number }
  | { readonly code: 'MENU_LIMIT_REACHED'; readonly limit: number };

/**
 * The photo and menu counts against the owner's effective grants — checked at submission for fast
 * feedback and again at approval, where the plan may have changed (rdm-spec C-11).
 */
export function payloadLimitBreach(
  payload: PlaceSubmissionPayload,
  grants: Entitlements,
): PayloadLimitBreach | null {
  const photos = effectiveLimit('maxPhotosPerPlace', grants);
  if (payload.photos.length > photos) return { code: 'PHOTO_LIMIT_REACHED', limit: photos };
  const items = effectiveLimit('maxMenuItemsPerPlace', grants);
  if (payload.menu.items.length > items) return { code: 'MENU_LIMIT_REACHED', limit: items };
  return null;
}

/** Whether the owner has room for one more Venue: their counted Venues plus pending creations. */
export function hasPlaceRoom(
  usage: { readonly used: number; readonly reserved: number },
  maxPlaces: number,
): boolean {
  return usage.used + usage.reserved < maxPlaces;
}
