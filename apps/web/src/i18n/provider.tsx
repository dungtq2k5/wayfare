'use client';

import type { Language } from '@wayfare/contracts';
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { createTranslator } from './messages';
import type { Messages, Translator } from './messages';

const TranslatorContext = createContext<Translator | null>(null);

/** Gives the client components below it the page's language (K7). */
export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Language;
  messages: Messages;
  children: ReactNode;
}) {
  const translator = useMemo(() => createTranslator(locale, messages), [locale, messages]);
  return <TranslatorContext.Provider value={translator}>{children}</TranslatorContext.Provider>;
}

/** The web app's only way to translate in a client component (keys and arguments type-checked). */
export function useWeb(): Translator {
  const translator = useContext(TranslatorContext);
  if (translator === null) throw new Error('useWeb() outside I18nProvider');
  return translator;
}
