'use client';

import { favoritesList } from '@wayfare/api-client';
import { setPageCookie } from '../client/cookies';
import { writeKv } from '../client/db';
import { ACCOUNT_HINT_COOKIE } from '../session/account-hint';

/** WA3c's numbers, kept until the favourites page says them once. */
export const MERGE_NOTE_KEY = 'mergeNote';

/** How many Places this browser saved before signing in (WA3c's "the {m} you saved here"). */
export async function countSavedHere(locale: string): Promise<number> {
  try {
    return (await favoritesList({ lang: locale, limit: 100 })).data.length;
  } catch {
    return 0;
  }
}

/** A path on this site to return to, never another origin. */
export function safeNext(next: string | null): string | null {
  return next !== null && next.startsWith('/') && !next.startsWith('//') ? next : null;
}

/**
 * A session just opened — the device it signed in with is claimed, so this browser's saves stay
 * (K2): the browser remembers it has one, WA3c's note is kept for the favourites page, and the
 * visitor returns where they were, a full load so the server renders with the new cookie.
 */
export async function completeSignIn(
  next: string | null,
  savedHere: number,
  locale: string,
): Promise<void> {
  setPageCookie(ACCOUNT_HINT_COOKIE, '1');
  const total = await countSavedHere(locale);
  // Only a union is news: saves from this browser joining the account's own.
  if (savedHere > 0 && total > savedHere)
    await writeKv(MERGE_NOTE_KEY, JSON.stringify({ others: total - savedHere, here: savedHere }));
  window.location.assign(safeNext(next) ?? '/favourites');
}
