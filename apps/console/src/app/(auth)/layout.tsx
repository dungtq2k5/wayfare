import { Wordmark } from '@wayfare/ui/wordmark';
import type { ReactNode } from 'react';
import { LanguageSwitch } from '../../auth/language-switch';

/**
 * The signed-out pages (C1–C5): the wordmark, one card, and the language switch under it. Top-aligned,
 * so the wordmark stays put from one page to the next.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center gap-6 px-4 pt-10 pb-12 sm:pt-16">
      <Wordmark height={36} />
      <div className="w-full max-w-sm">{children}</div>
      <LanguageSwitch />
    </main>
  );
}
