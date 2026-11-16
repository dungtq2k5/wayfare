'use client';

import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

interface PickerState {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
}

const PickerContext = createContext<PickerState | null>(null);

/** The language picker's one open state: the header's button and WQ6's *Choose* both open it. */
export function LanguagePickerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <PickerContext.Provider value={{ open, setOpen }}>{children}</PickerContext.Provider>;
}

export function useLanguagePicker(): PickerState {
  const state = useContext(PickerContext);
  if (state === null) throw new Error('useLanguagePicker() outside LanguagePickerProvider');
  return state;
}
