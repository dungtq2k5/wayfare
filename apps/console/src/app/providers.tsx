'use client';

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@wayfare/api-client';
import { Toaster } from '@wayfare/ui/toaster';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import '../client/browser-api';
import { noteOutcome } from '../client/connection';
import { setPageCookie } from '../client/cookies';
import { I18nProvider } from '../i18n/provider';
import type { ConsoleLocale } from '../i18n/messages';
import { signInHref } from '../session/next';
import { THEME_COOKIE } from '../theme';
import type { Theme } from '../theme';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

/** The appearance (K11): per browser, applied at once and remembered in a cookie. */
export function useTheme(): ThemeState {
  const state = useContext(ThemeContext);
  if (state === null) throw new Error('useTheme() outside Providers');
  return state;
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  const dark =
    theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', dark);
}

/**
 * A read that failed after K4's refresh: the session is over, and browsing returns to Sign in with
 * C5's line, then back here. A form's save handles its own `401` (P3c) instead.
 */
function onQueryError(error: unknown): void {
  noteOutcome(error);
  if (error instanceof ApiError && error.status === 401 && error.code === 'UNAUTHENTICATED') {
    window.location.assign(signInHref(`${location.pathname}${location.search}`, true));
  }
  // New terms (K18): the shell's server check shows the page that asks for them.
  if (error instanceof ApiError && error.code === 'LEGAL_VERSION_OUTDATED')
    window.location.reload();
}

export function Providers({
  locale,
  theme: initialTheme,
  children,
}: {
  locale: ConsoleLocale;
  theme: Theme;
  children: ReactNode;
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({ onError: onQueryError, onSuccess: () => noteOutcome(null) }),
        mutationCache: new MutationCache({
          onError: noteOutcome,
          onSuccess: () => noteOutcome(null),
        }),
        defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
      }),
  );
  const [theme, setThemeState] = useState(initialTheme);
  const setTheme = useCallback((next: Theme) => {
    setPageCookie(THEME_COOKIE, next);
    setThemeState(next);
    applyTheme(next);
  }, []);
  useEffect(() => {
    if (theme !== 'system') return;
    const query = matchMedia('(prefers-color-scheme: dark)');
    const follow = () => applyTheme('system');
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, [theme]);

  return (
    <QueryClientProvider client={client}>
      <ThemeContext.Provider value={{ theme, setTheme }}>
        <I18nProvider locale={locale}>
          {children}
          <Toaster theme={theme} />
        </I18nProvider>
      </ThemeContext.Provider>
    </QueryClientProvider>
  );
}
