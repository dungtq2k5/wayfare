'use client';

import { ApiError, authGoogleSignIn } from '@wayfare/api-client';
import { useCallback, useState } from 'react';
import { useWeb } from '../i18n/provider';
import { completeSignIn, countSavedHere } from './complete-sign-in';

/** A `GOOGLE_LINK_NEEDS_PASSWORD` answer, held in memory only (WA2). */
export interface LinkTicket {
  readonly linkTicket: string;
  readonly email: string;
  readonly at: number;
}

/** The address a Google ID token names — read for display; identity verified the token. */
function tokenEmail(idToken: string): string {
  try {
    const payload = idToken.split('.')[1] ?? '';
    const email = (
      JSON.parse(atob(payload.replaceAll('-', '+').replaceAll('_', '/'))) as { email?: unknown }
    ).email;
    return typeof email === 'string' ? email : '';
  } catch {
    return '';
  }
}

/**
 * *Continue with Google* (WA1b): with the device's bearer, which it claims as a sign-in does; an
 * address Google doesn't own that already has an account answers with a link ticket (WA2).
 */
export function useGoogleContinue(next: string | null) {
  const { t, tDynamic, locale } = useWeb();
  const [ticket, setTicket] = useState<LinkTicket | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onCredential = useCallback(
    async (idToken: string) => {
      setBusy(true);
      setAlert(null);
      const savedHere = await countSavedHere(locale);
      try {
        await authGoogleSignIn({ idToken, preferredLocale: locale });
        await completeSignIn(next, savedHere, locale);
      } catch (error) {
        const details = error instanceof ApiError ? error.details : undefined;
        const linkTicket = (details as { linkTicket?: unknown } | undefined)?.linkTicket;
        if (
          error instanceof ApiError &&
          error.code === 'GOOGLE_LINK_NEEDS_PASSWORD' &&
          typeof linkTicket === 'string'
        ) {
          setTicket({ linkTicket, email: tokenEmail(idToken), at: Date.now() });
        } else {
          setAlert(
            error instanceof ApiError ? tDynamic(`error.${error.code}`) : t('error.generic'),
          );
        }
        setBusy(false);
      }
    },
    [next, locale, t, tDynamic],
  );
  const expire = useCallback(() => {
    setTicket(null);
    setAlert(t('gLink.expired'));
  }, [t]);
  return { ticket, alert, busy, onCredential, expire };
}
