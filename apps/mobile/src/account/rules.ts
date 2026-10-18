/** Favourites from which Favourites offers an account (frame E2, K19): two is a habit worth keeping. */
export const ACCOUNT_OFFER_MIN_FAVOURITES = 2;

/** Whether Favourites shows the offer: signed out, never dismissed here, with enough favourites. */
export function shouldOfferAccount(input: {
  readonly signedIn: boolean;
  readonly dismissed: boolean;
  readonly favourites: number;
}): boolean {
  return !input.signedIn && !input.dismissed && input.favourites >= ACCOUNT_OFFER_MIN_FAVOURITES;
}

/** The word the API takes to delete an account (K14), whatever the tourist typed. */
export const API_DELETE_WORD = 'DELETE';

/**
 * Whether the typed word is the tourist's language's ("DELETE", "XÓA"): exactly, ignoring the
 * spaces around it and how the keyboard composed its accents.
 */
export function deleteWordMatches(typed: string, word: string): boolean {
  return typed.trim().normalize('NFC') === word.normalize('NFC');
}

/** Frame G6's toast: the count of the phone's own favourites, or "Signed in" with none (K6). */
export function signedInCount(favouritesBefore: number): number | null {
  return favouritesBefore > 0 ? favouritesBefore : null;
}

/** Frame G7 (K3): this phone had another account signed in before this one. */
export function phoneMoved(lastAccountId: string | null, accountId: string): boolean {
  return lastAccountId !== null && lastAccountId !== accountId;
}

/** The documents to accept again (K16): those of `wanted` the server says are not current. */
export function outdatedDocuments<D extends string>(
  rows: readonly { readonly document: string; readonly current: boolean }[],
  wanted: readonly D[],
): D[] {
  return rows
    .filter((row) => !row.current && wanted.includes(row.document as D))
    .map((row) => row.document as D);
}
