import { i18nBundle, NETWORK_ERROR_CODE, ApiError } from '@wayfare/api-client';
import en from '@wayfare/i18n/locales/en/tourist.json';
import vi from '@wayfare/i18n/locales/vi/tourist.json';
import { Directory, File, Paths } from 'expo-file-system';
import { getLocales } from 'expo-localization';
import i18next from 'i18next';
import ICU from 'i18next-icu';
import { initReactI18next } from 'react-i18next';
import { loadBundle } from './bundles';
import type { BundleLoaderDeps, CachedBundle } from './bundles';
import { normalizeLang } from '@wayfare/contracts';

export const NAMESPACE = 'tourist';

/** Bundled in the app: the picker and the first run work with no network. */
const BUNDLED = ['en', 'vi'] as const;
const isBundled = (language: string): boolean => (BUNDLED as readonly string[]).includes(language);

/** The phone's own language when the app ships its strings, English otherwise. */
function deviceLanguage(): string {
  const tag = getLocales()[0]?.languageTag;
  const language = tag === undefined ? null : normalizeLang(tag);
  return language !== null && isBundled(language) ? language : 'en';
}

// ICU messages (`{count, plural, …}`), one namespace, and flat keys that contain dots.
void i18next
  .use(ICU)
  .use(initReactI18next)
  .init({
    lng: deviceLanguage(),
    fallbackLng: 'en',
    ns: [NAMESPACE],
    defaultNS: NAMESPACE,
    resources: { en: { [NAMESPACE]: en }, vi: { [NAMESPACE]: vi } },
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    initAsync: false,
    react: { useSuspense: false },
  });

const cacheFile = (locale: string): File =>
  new File(Paths.document, 'ui-bundles', `${NAMESPACE}.${locale}.json`);

const deps: BundleLoaderDeps = {
  fetchBundle: async (locale, sourceHash) => {
    const { data } = await i18nBundle(NAMESPACE, locale, sourceHash ? { sourceHash } : undefined);
    return data;
  },
  readCache: async (locale) => {
    const file = cacheFile(locale);
    return file.exists ? (JSON.parse(await file.text()) as CachedBundle) : null;
  },
  writeCache: (locale, bundle) => {
    const directory = new Directory(Paths.document, 'ui-bundles');
    if (!directory.exists) directory.create({ intermediates: true });
    cacheFile(locale).write(JSON.stringify(bundle));
    return Promise.resolve();
  },
  apply: (locale, messages) => {
    i18next.addResourceBundle(locale, NAMESPACE, messages, true, true);
  },
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  isCurrent: (locale) => i18next.language === locale,
};

/**
 * Shows the app in `language`: at once from what is bundled, otherwise in English while the
 * language's bundle is fetched (or read from the phone's cache) and swapped in.
 */
export async function applyLanguage(language: string): Promise<void> {
  await i18next.changeLanguage(language);
  if (!isBundled(language)) await loadBundle(language, deps);
}

/** The message for a failed call, chosen by the envelope's `code` (api-endpoints-plan §0.4). */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === NETWORK_ERROR_CODE) return i18next.t('error.network');
    return i18next.t([`error.${error.code}`, 'error.generic']);
  }
  return i18next.t('error.generic');
}

export default i18next;
