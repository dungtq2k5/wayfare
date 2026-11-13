'use client';

import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { createTranslator } from './messages';
import type { ConsoleLocale, Translator } from './messages';

const TranslatorContext = createContext<Translator | null>(null);

/** Gives the client components below it the page's language (K12). */
export function I18nProvider({ locale, children }: { locale: ConsoleLocale; children: ReactNode }) {
  const translator = useMemo(() => createTranslator(locale), [locale]);
  return <TranslatorContext.Provider value={translator}>{children}</TranslatorContext.Provider>;
}

/** The console's only way to translate in a client component (keys and arguments type-checked). */
export function useConsole(): Translator {
  const translator = useContext(TranslatorContext);
  if (translator === null) throw new Error('useConsole() outside I18nProvider');
  return translator;
}
