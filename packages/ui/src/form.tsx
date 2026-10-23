'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Card, CardTitle } from './surfaces';

/** One of a form page's sections: a card with its title (P3). */
export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-4">
      <CardTitle>{title}</CardTitle>
      {children}
    </Card>
  );
}

/** *Save* and *Cancel* in a bar that stays in view at the bottom of the page (P3). */
export function SaveBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex justify-end gap-2 border-t border-border bg-background px-4 py-3 sm:-mx-6 sm:px-6">
      {children}
    </div>
  );
}

/**
 * Leaving a form with changes asks once (P3b). A link clicked anywhere on the page is held and
 * handed to `onAttempt`, which asks and then follows it; closing or reloading the tab gets the
 * browser's own question, the only one a page may ask there.
 */
export function useLeaveGuard(dirty: boolean, onAttempt: (href: string) => void): void {
  const attempt = useRef(onAttempt);
  useEffect(() => {
    attempt.current = onAttempt;
  });
  useEffect(() => {
    if (!dirty) return;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest('a[href]');
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank') return;
      const url = new URL(link.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search)
        return;
      event.preventDefault();
      event.stopPropagation();
      attempt.current(`${url.pathname}${url.search}${url.hash}`);
    };
    const onUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    document.addEventListener('click', onClick, true);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [dirty]);
}
