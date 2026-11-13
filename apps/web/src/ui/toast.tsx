'use client';

import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

interface Toast {
  message: string;
  icon?: LucideIcon;
}
type Listener = (toast: Toast | null) => void;
const listeners = new Set<Listener>();
let timer: ReturnType<typeof setTimeout> | undefined;

/** Shows a short message at the bottom of the page for `ms`; a newer one replaces it. */
export function showToast(
  message: string,
  { icon, ms = 4_000 }: { icon?: LucideIcon; ms?: number } = {},
): void {
  clearTimeout(timer);
  for (const listener of listeners) listener({ message, ...(icon ? { icon } : {}) });
  timer = setTimeout(() => {
    for (const listener of listeners) listener(null);
  }, ms);
}

/** Where toasts appear, announced politely. Mount once, in the layout. */
export function ToastHost() {
  const [toast, setToast] = useState<Toast | null>(null);
  useEffect(() => {
    listeners.add(setToast);
    return () => {
      listeners.delete(setToast);
    };
  }, []);
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
    >
      {toast === null ? null : (
        <p className="flex max-w-120 items-center gap-3 rounded-lg bg-foreground py-3 pl-4 pr-2 text-sm font-medium text-background shadow-2">
          {toast.icon === undefined ? null : <toast.icon aria-hidden className="size-5 shrink-0" />}
          <span>{toast.message}</span>
        </p>
      )}
    </div>
  );
}
