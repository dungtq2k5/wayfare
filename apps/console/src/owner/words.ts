import { NarrationLanguageScope, scopeCoversLanguage, scopeLanguages } from '@wayfare/contracts';
import type { Language } from '@wayfare/contracts';
import type { StatusTone } from '@wayfare/ui/surfaces';

/** A Venue's status as the API gives it: the status, and why it is off the map. */
export interface VenueState {
  readonly status: 'DRAFT' | 'PROCESSING' | 'ACTIVE' | 'INACTIVE';
  readonly inactiveReason: 'ADMIN' | 'OWNER' | 'ENTITLEMENT_LIMIT' | null;
}

/** How an owner reads a Venue's status: its words, its badge, and its line, if any. */
export interface VenueWords {
  readonly label:
    | 'venue.live'
    | 'venue.processing'
    | 'venue.draft'
    | 'venue.closed'
    | 'venue.takenDown'
    | 'venue.offMap';
  readonly tone: StatusTone;
  readonly line: 'venue.processingLine' | 'venue.since' | 'venue.writeSupport' | null;
}

/** A Venue's status in words (K5, the handoff's table) — never a code. */
export function venueWords({ status, inactiveReason }: VenueState): VenueWords {
  switch (status) {
    case 'ACTIVE':
      return { label: 'venue.live', tone: 'active', line: null };
    case 'PROCESSING':
      return { label: 'venue.processing', tone: 'processing', line: 'venue.processingLine' };
    case 'DRAFT':
      return { label: 'venue.draft', tone: 'draft', line: null };
    case 'INACTIVE':
      return inactiveReason === 'ADMIN'
        ? { label: 'venue.takenDown', tone: 'rejected', line: 'venue.writeSupport' }
        : inactiveReason === 'ENTITLEMENT_LIMIT'
          ? { label: 'venue.offMap', tone: 'inactive', line: 'venue.since' }
          : { label: 'venue.closed', tone: 'inactive', line: 'venue.since' };
  }
}

/** The order scopes widen in, for "which plan adds it". */
const SCOPES = [
  NarrationLanguageScope.BASIC,
  NarrationLanguageScope.LAUNCH,
  NarrationLanguageScope.EXTENDED,
] as const;

/**
 * M2's narration rows (K5): every language the plan narrates, then those the next wider scope adds,
 * marked *Not in your plan* — what the plan covers is the contracts' own list.
 */
export function narrationLanguages(
  scope: NarrationLanguageScope,
): { readonly lang: Language; readonly inPlan: boolean }[] {
  const next = SCOPES[SCOPES.indexOf(scope) + 1];
  const outside =
    next === undefined
      ? []
      : scopeLanguages(next).filter((lang) => !scopeCoversLanguage(scope, lang));
  return [
    ...scopeLanguages(scope).map((lang) => ({ lang, inPlan: true })),
    ...outside.map((lang) => ({ lang, inPlan: false })),
  ];
}

/** Home's first view (K19): N8 for a verified owner with no venue and no submission; Z1 once either exists. */
export const homeView = (venues: number, submissions: number): 'welcome' | 'home' =>
  venues === 0 && submissions === 0 ? 'welcome' : 'home';
