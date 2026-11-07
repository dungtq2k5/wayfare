'use client';

import { useQueryClient } from '@tanstack/react-query';
import { AnalyticsEventType } from '@wayfare/contracts';
import { track } from '../analytics/analytics';
import { devicesUpdate, usersUpdate } from '@wayfare/api-client';
import type { Language } from '@wayfare/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import { setPageCookie } from '../client/cookies';
import { ME_KEY } from '../account/me';
import { readPageCookie } from '../client/cookies';
import { ACCOUNT_HINT_COOKIE } from '../session/account-hint';
import { LANGUAGE_COOKIE } from './language';

/**
 * Choosing a language (K7): kept on this browser, sent as the device's content language and, when
 * signed in, the account's; the page re-renders in it at once. A story already playing keeps its
 * own language (round 29) — the player reads the page's language only for the next one.
 */
export function useChooseLanguage(): {
  choose: (lang: Language) => void;
  pending: boolean;
} {
  const router = useRouter();
  const queries = useQueryClient();
  const [pending, startTransition] = useTransition();
  const choose = useCallback(
    (lang: Language) => {
      setPageCookie(LANGUAGE_COOKIE, lang);
      startTransition(() => router.refresh());
      track({ type: AnalyticsEventType.LANGUAGE_SELECTED, lang });
      // Best effort: the page already switched; the device and account follow when they can.
      void devicesUpdate({ contentLocale: lang }).catch(() => undefined);
      if (readPageCookie(ACCOUNT_HINT_COOKIE) !== null) {
        void usersUpdate({ preferredLocale: lang })
          .then(() => queries.invalidateQueries({ queryKey: ME_KEY }))
          .catch(() => undefined);
      }
    },
    [router, queries],
  );
  return { choose, pending };
}
