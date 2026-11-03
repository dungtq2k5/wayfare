'use client';

import { useQuery } from '@tanstack/react-query';
import { ApiError, usersMe } from '@wayfare/api-client';
import { clearPageCookie, readPageCookie } from '../client/cookies';
import { ACCOUNT_HINT_COOKIE } from '../session/account-hint';

export const ME_KEY = ['me'] as const;

/** Who is signed in on this browser, or `null`: asked only when the hint says someone is. */
export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      if (readPageCookie(ACCOUNT_HINT_COOKIE) === null) return null;
      try {
        return (await usersMe()).data;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          clearPageCookie(ACCOUNT_HINT_COOKIE);
          return null;
        }
        throw error;
      }
    },
    staleTime: 60_000,
  });
}

/** What `useMe` answers when someone is signed in. */
export type Me = NonNullable<ReturnType<typeof useMe>['data']>;
