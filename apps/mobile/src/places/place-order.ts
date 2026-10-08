import { distanceMeters, walkingEtaMinutes } from '@wayfare/core';
import type { PlaceSyncRecord } from '@wayfare/contracts';

/** A synced Place with how far it is, when the phone knows where it is. */
export interface ListedPlace {
  readonly record: PlaceSyncRecord;
  readonly distanceM: number | null;
  readonly walkingMinutes: number | null;
}

/** Letters without their marks, `đ` as `d`: the fallback when the collator cannot order Vietnamese. */
export function foldDiacritics(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/**
 * Compares names for a reader of `lang`. `Intl.Collator` does it when Hermes honours the locale; if
 * it ignores it (its plural rules were incomplete too), the names are compared with their marks
 * folded — close to right, which the no-position note already admits.
 */
export function nameComparer(lang: string, collatorOf: typeof makeCollator = makeCollator) {
  const collator = collatorOf(lang);
  if (collator !== null) return (a: string, b: string) => collator.compare(a, b);
  return (a: string, b: string) => {
    const folded = foldDiacritics(a).toLowerCase();
    const other = foldDiacritics(b).toLowerCase();
    if (folded === other) return a < b ? -1 : a > b ? 1 : 0;
    return folded < other ? -1 : 1;
  };
}

/** The collator for `lang`, or null when the runtime does not honour the locale. */
export function makeCollator(lang: string): Intl.Collator | null {
  try {
    const collator = new Intl.Collator(lang);
    const base = lang.split('-')[0] ?? lang;
    return collator.resolvedOptions().locale.startsWith(base) ? collator : null;
  } catch {
    return null;
  }
}

/** Nearest first, with the distance and the walking time of each. */
export function byDistance(
  records: readonly PlaceSyncRecord[],
  origin: { lat: number; lng: number },
): ListedPlace[] {
  return records
    .map((record) => {
      const distanceM = distanceMeters(origin, record.location);
      return { record, distanceM, walkingMinutes: walkingEtaMinutes(distanceM) };
    })
    .sort((a, b) => a.distanceM - b.distanceM || (a.record.id < b.record.id ? -1 : 1));
}

/** The area in view first, the others in their id order, and by name inside each; no distances. */
export function byAreaThenName(
  records: readonly PlaceSyncRecord[],
  currentAreaId: string | null,
  lang: string,
  collatorOf?: typeof makeCollator,
): ListedPlace[] {
  const compare = nameComparer(lang, collatorOf);
  const rank = (areaId: string) => (areaId === currentAreaId ? '' : areaId);
  return [...records]
    .sort((a, b) => {
      const area = rank(a.areaId);
      const other = rank(b.areaId);
      if (area !== other) return area < other ? -1 : 1;
      return compare(a.localization.name, b.localization.name);
    })
    .map((record) => ({ record, distanceM: null, walkingMinutes: null }));
}
