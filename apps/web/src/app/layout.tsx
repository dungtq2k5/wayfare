import type { Metadata, Viewport } from 'next';
import { cookies, headers } from 'next/headers';
import type { ReactNode } from 'react';
import { FONT_VARIABLES } from '../fonts';
import { messagesFor, requestLanguage, serverTranslator } from '../i18n/server';
import { ACCOUNT_HINT_COOKIE } from '../session/account-hint';
import { SiteHeader } from '../shell/header';
import { LanguageBar } from '../shell/language-bar';
import { OfflineBar } from '../offline/offline-bar';
import { SYSTEM_THEME_SCRIPT, THEME_COOKIE, themeOf } from '../theme';
import './globals.css';
import { Providers } from './providers';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverTranslator();
  return {
    title: { default: t('app.name'), template: `%s · ${t('app.name')}` },
    description: t('app.description'),
    applicationName: t('app.name'),
  };
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

/**
 * The document (the handoff's §11): the page's language (K7), the appearance from its cookie — dark
 * rendered by the server so nothing flashes — a skip link first, then the header, and the page.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  // This request's nonce, from the proxy: the theme script is the page's one inline script.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const { lang, unsupported } = await requestLanguage();
  const messages = await messagesFor(lang);
  const { t } = await serverTranslator();
  const theme = themeOf(jar.get(THEME_COOKIE)?.value);
  return (
    <html
      lang={lang}
      data-theme={theme}
      className={`${FONT_VARIABLES}${theme === 'dark' ? ' dark' : ''}`}
      suppressHydrationWarning
    >
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: SYSTEM_THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh flex-col">
        <Providers locale={lang} messages={messages} theme={theme}>
          <a
            href="#content"
            className="sr-only z-50 rounded-md bg-card px-4 py-2 text-sm font-medium text-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:ring-2 focus:ring-ring"
          >
            {t('shell.skip')}
          </a>
          <SiteHeader signedIn={jar.has(ACCOUNT_HINT_COOKIE)} />
          {unsupported ? <LanguageBar /> : null}
          <OfflineBar />
          {children}
        </Providers>
      </body>
    </html>
  );
}
