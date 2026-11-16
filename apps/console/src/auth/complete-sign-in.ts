'use client';

import { setPageCookie, SIGNED_IN_MARKER } from '../client/cookies';
import { accountLocale, LANGUAGE_COOKIE } from '../i18n/language';
import { safeNext } from '../session/next';

/**
 * A session just opened: the console remembers that it has one (C5), its pages take the account's
 * language (K12), and the visitor returns to the same-site page they came for — a full load, so
 * the server renders it with the new cookies.
 */
export function completeSignIn(user: { preferredLocale: string }, next: string | null): void {
  setPageCookie(SIGNED_IN_MARKER, '1');
  setPageCookie(LANGUAGE_COOKIE, accountLocale(user.preferredLocale));
  window.location.assign(safeNext(next) ?? '/');
}
