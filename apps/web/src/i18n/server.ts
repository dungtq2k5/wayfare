import 'server-only';
import type { Language } from '@wayfare/contracts';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { GATEWAY_INTERNAL_URL, SERVER_CACHE_SECONDS } from '../env';
import { LANGUAGE_COOKIE, pageLanguage } from './language';
import { BUNDLED, createTranslator, ENGLISH, sharedNames } from './messages';
import type { Messages, Translator } from './messages';

/** This request's page language (K7), read once per request. */
export const requestLanguage = cache(async () =>
  pageLanguage(
    (await cookies()).get(LANGUAGE_COOKIE)?.value,
    (await headers()).get('accept-language'),
  ),
);

/** One namespace of a language the app doesn't ship, from narration's pipeline (`/i18n`). */
async function fetchBundle(namespace: 'web' | 'tourist', lang: Language): Promise<Messages> {
  try {
    const response = await fetch(
      `${GATEWAY_INTERNAL_URL}/api/v1/i18n/bundles/${namespace}/${lang}`,
      { headers: { 'x-wayfare-client': 'web' }, next: { revalidate: SERVER_CACHE_SECONDS } },
    );
    if (!response.ok) return {};
    // A PENDING bundle carries the English strings: the page renders, and asks again later.
    return ((await response.json()) as { data: { messages: Messages } }).data.messages;
  } catch {
    return {};
  }
}

/**
 * A language's messages: English and Vietnamese ship with the app; any other comes translated from
 * the pipeline, each missing key read in English.
 */
export const messagesFor = cache(async (lang: Language): Promise<Messages> => {
  const bundled = BUNDLED[lang];
  if (bundled !== undefined) return bundled;
  const [web, tourist] = await Promise.all([
    fetchBundle('web', lang),
    fetchBundle('tourist', lang),
  ]);
  return { ...ENGLISH, ...sharedNames(tourist), ...web };
});

/** The page's translator, for a server component. */
export async function serverTranslator(): Promise<Translator> {
  const { lang } = await requestLanguage();
  return createTranslator(lang, await messagesFor(lang));
}
