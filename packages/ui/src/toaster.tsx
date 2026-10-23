'use client';

import { Toaster as Sonner, toast } from 'sonner';

/** Success lasts 6 s; an error stays until it is closed (P5). */
export const SUCCESS_TOAST_MS = 6000;

/** The toasts (P5): bottom right, newest at the bottom, in the tokens' colours. */
export function Toaster({ theme }: { theme: 'light' | 'dark' | 'system' }) {
  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      closeButton
      duration={SUCCESS_TOAST_MS}
      toastOptions={{
        classNames: {
          toast: 'bg-card text-card-foreground border border-border shadow-3 font-sans',
          description: 'text-muted-foreground',
          error: 'border-destructive',
          actionButton: 'bg-primary text-primary-foreground',
        },
      }}
    />
  );
}

export { toast };
