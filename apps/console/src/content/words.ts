import type { StatusTone } from '@wayfare/ui/surfaces';

/** A Place's lifecycle, as the API names it. */
export type PlaceStatus = 'DRAFT' | 'PROCESSING' | 'ACTIVE' | 'INACTIVE';
export type InactiveReason = 'ADMIN' | 'OWNER' | 'ENTITLEMENT';
export type PlaceKind = 'EDITORIAL' | 'VENUE';

const STATUS_TONES = {
  DRAFT: 'draft',
  PROCESSING: 'processing',
  ACTIVE: 'active',
  INACTIVE: 'inactive',
} as const satisfies Record<PlaceStatus, StatusTone>;

/** The badge's tone for a status. */
export const statusTone = (status: PlaceStatus): StatusTone => STATUS_TONES[status];

/**
 * Why a row waits (K1): the line under its status — the same words round 36's owner pages use.
 * An active Place waits for nothing.
 */
export function waitKey(
  status: PlaceStatus,
  reason: InactiveReason | null,
): `wait.${string}` | null {
  if (status === 'PROCESSING') return 'wait.PROCESSING';
  if (status === 'DRAFT') return 'wait.DRAFT';
  if (status === 'INACTIVE') return `wait.${reason ?? 'ADMIN'}`;
  return null;
}

/** One language of a Place's narration, as the detail reports it. */
export interface LocalizationState {
  readonly lang: string;
  readonly textReady: boolean;
  readonly stale: boolean;
  readonly audioStatus: string;
  readonly audioStale: boolean;
}

/** What a tourist in `lang` hears meanwhile (rdm-spec §1.5's content tiers). */
export type TouristsGet = 'self' | 'english' | 'source';

/**
 * "Tourists get" (K3): the language itself when its text is ready, else English when English is,
 * else the Vietnamese source. Out-of-date text is still served until it is redone.
 */
export function touristsGet(
  lang: string,
  localizations: readonly LocalizationState[],
): TouristsGet {
  if (lang === 'vi') return 'self';
  const ready = (code: string) => localizations.some((row) => row.lang === code && row.textReady);
  if (ready(lang)) return 'self';
  return ready('en') ? 'english' : 'source';
}

/** An action whose success toast may carry *Undo*. */
export type UndoableAction = 'deactivate' | 'delete' | 'approve' | 'reject';

/**
 * Undo's rule (K7, K9; the product owner's, from round 33): only where the inverse is one ordinary
 * call and nobody else has seen the action — an Editorial Place's deactivation. A Venue's owner is
 * told at once; a delete stops the stickers at once; a decision is mailed.
 */
export function hasUndo(action: UndoableAction, kind: PlaceKind): boolean {
  return action === 'deactivate' && kind === 'EDITORIAL';
}

/** A public code as stickers print it: 4 + 4. */
export const printedCode = (code: string): string =>
  code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code;

/** The radius's street comparison (L6): small, about half a block, or about a block. */
export function radiusComparison(
  metres: number,
): 'editorial.fiveShopfronts' | 'editorial.halfBlock' | 'editorial.aBlock' {
  if (metres <= 25) return 'editorial.fiveShopfronts';
  if (metres <= 60) return 'editorial.halfBlock';
  return 'editorial.aBlock';
}
