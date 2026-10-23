import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import type { ReactNode } from 'react';
import { beVietnamPro } from '../fonts';
import { LANGUAGE_COOKIE, signedOutLocale } from '../i18n/language';
import { createTranslator } from '../i18n/messages';
import { SYSTEM_THEME_SCRIPT, THEME_COOKIE, themeOf } from '../theme';
import './globals.css';
import { Providers } from './providers';

export async function generateMetadata(): Promise<Metadata> {
  const locale = signedOutLocale(
    (await cookies()).get(LANGUAGE_COOKIE)?.value,
    (await headers()).get('accept-language'),
  );
  return { title: createTranslator(locale).t('app.name') };
}

/**
 * The document: the language of a signed-out page (K12) — a signed-in page's shell provides the
 * account's — and the appearance from its cookie, dark rendered by the server so nothing flashes.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const locale = signedOutLocale(
    jar.get(LANGUAGE_COOKIE)?.value,
    (await headers()).get('accept-language'),
  );
  const theme = themeOf(jar.get(THEME_COOKIE)?.value);
  return (
    <html
      lang={locale}
      data-theme={theme}
      className={`${beVietnamPro.variable}${theme === 'dark' ? ' dark' : ''}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: SYSTEM_THEME_SCRIPT }} />
      </head>
      <body>
        <Providers locale={locale} theme={theme}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
