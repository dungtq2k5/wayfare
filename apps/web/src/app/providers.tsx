'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Language } from '@wayfare/contracts';
import { Toaster } from '@wayfare/ui/toaster';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import '../client/browser-api';
import { setPageCookie } from '../client/cookies';
import type { Messages } from '../i18n/messages';
import { I18nProvider } from '../i18n/provider';
import { AccountOfferProvider } from '../favourites/account-offer';
import { PlayerSurfaces } from '../player/surfaces';
import { ConsentHost } from '../analytics/consent-dialog';
import { ToastHost } from '../ui/toast';
import { InstallPrompt } from '../prompts/install-prompt';
import { LanguagePickerProvider } from '../shell/language-picker-state';
import { THEME_COOKIE } from '../theme';
import type { Theme } from '../theme';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

/** The appearance (WS1): per browser, applied at once and remembered in a cookie. */
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

export function Providers({
  locale,
  messages,
  theme: initialTheme,
  children,
}: {
  locale: Language;
  messages: Messages;
  theme: Theme;
  children: ReactNode;
}) {
  const [client] = useState(
    () =>
      new QueryClient({
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
        <I18nProvider locale={locale} messages={messages}>
          <LanguagePickerProvider>
            <AccountOfferProvider>{children}</AccountOfferProvider>
            <PlayerSurfaces />
            <ConsentHost />
            <ToastHost />
            <InstallPrompt />
            <Toaster theme={theme} />
          </LanguagePickerProvider>
        </I18nProvider>
      </ThemeContext.Provider>
    </QueryClientProvider>
  );
}
