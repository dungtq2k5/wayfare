// Hermes has no complete Intl.PluralRules, and ICU plurals (`{count, plural, …}`) need it: without
// it every plural renders as its raw message. The polyfill installs only where it is missing.
// Every served language: a long-tail switch shows that language's machine-translated bundle.
import '@formatjs/intl-pluralrules/polyfill.js';
import '@formatjs/intl-pluralrules/locale-data/en.js';
import '@formatjs/intl-pluralrules/locale-data/vi.js';
import '@formatjs/intl-pluralrules/locale-data/zh.js';
import '@formatjs/intl-pluralrules/locale-data/ja.js';
import '@formatjs/intl-pluralrules/locale-data/ko.js';
import '@formatjs/intl-pluralrules/locale-data/fr.js';
import '@formatjs/intl-pluralrules/locale-data/de.js';
import '@formatjs/intl-pluralrules/locale-data/es.js';
import '@formatjs/intl-pluralrules/locale-data/ru.js';
import '@formatjs/intl-pluralrules/locale-data/th.js';
import '@formatjs/intl-pluralrules/locale-data/id.js';
import '@formatjs/intl-pluralrules/locale-data/ms.js';
import '@formatjs/intl-pluralrules/locale-data/hi.js';
import { i18nBundle, NETWORK_ERROR_CODE, ApiError } from '@wayfare/api-client';
import en from '@wayfare/i18n/locales/en/tourist.json';
import vi from '@wayfare/i18n/locales/vi/tourist.json';
import { Directory, File, Paths } from 'expo-file-system';
import { getLocales } from 'expo-localization';
import i18next from 'i18next';
import ICU from 'i18next-icu';
import { initReactI18next } from 'react-i18next';
import { useAppStore } from '../state/app-store';
import { loadBundle } from './bundles';
import { useSwitchHolds } from './switch-holds';
import { touristFrom } from './tourist';
import type { Tourist } from './tourist';
import type { BundleLoaderDeps, BundleOutcome, CachedBundle } from './bundles';
import { normalizeLang } from '@wayfare/contracts';

export const NAMESPACE = 'tourist';

/** Bundled in the app: the picker and the first run work with no network. */
const BUNDLED = ['en', 'vi'] as const;
export const isBundled = (language: string): boolean =>
  (BUNDLED as readonly string[]).includes(language);

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
    // ICU keeps one formatter per language and key; one made while a language had no messages yet
    // holds the English fallback, so the cache is dropped whenever messages are added.
    i18nFormat: { bindI18nStore: 'added' },
  });

const cacheFile = (locale: string): File =>
  new File(Paths.document, 'ui-bundles', `${NAMESPACE}.${locale}.json`);

const deps: BundleLoaderDeps = {
  fetchBundle: async (locale, sourceHash) => {
    const { data } = await i18nBundle(NAMESPACE, locale, sourceHash ? { sourceHash } : undefined);
    // Diagnostics' hold: the bundle answers as still translating, with English, as the server does.
    if (useSwitchHolds.getState().holdBundle) {
      return { ...data, status: 'PENDING', messages: {}, retryAfterMs: null };
    }
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
  // i18next stays on the old language through a switch, so it cannot say what is wanted.
  isWanted: (locale) => {
    const { language, pendingLanguage } = useAppStore.getState();
    return language === locale || pendingLanguage === locale;
  },
};

/**
 * Brings a language's UI strings into i18next without changing its language: from the phone's
 * cache at once, then the server's.
 */
export const loadUi = (
  locale: string,
  options: Pick<BundleLoaderDeps, 'isWanted' | 'onPending'> = {},
): Promise<BundleOutcome> => loadBundle(locale, { ...deps, ...options });

/**
 * Whether `locale`'s words are on the phone — in the app, or kept from an earlier fetch — and so in
 * i18next, ready to show with no network.
 */
export async function uiFromPhone(locale: string): Promise<boolean> {
  if (isBundled(locale)) return true;
  const cached = await deps.readCache(locale).catch(() => null);
  if (cached !== null) deps.apply(locale, cached.messages);
  return cached !== null;
}

/**
 * Shows the app in `language`, which the store has already switched to: what is bundled or cached
 * at once, then the server's newer words. A bundle that lands later redraws every screen, since
 * react-i18next re-renders on a language change, not on added messages; `landed` is told.
 */
export async function showLanguage(
  language: string,
  landed: (language: string) => void,
): Promise<void> {
  await i18next.changeLanguage(language);
  if (isBundled(language)) return;
  if ((await loadUi(language)) !== 'ready' || i18next.language !== language) return;
  await i18next.changeLanguage(language);
  landed(language);
}

/** The message for a failed call, chosen by the envelope's `code` (api-endpoints-plan §0.4). */
export function errorMessage(error: unknown): string {
  const { t, tFamily } = touristFrom(i18next);
  if (error instanceof ApiError) {
    return error.code === NETWORK_ERROR_CODE ? t('error.network') : tFamily('error', error.code);
  }
  return t('error.generic');
}

/** The typed translation functions, for code that is not a component (the player's notification). */
export const tourist = (): Tourist => touristFrom(i18next);

export default i18next;
