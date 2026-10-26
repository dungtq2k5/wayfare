'use client';

import { CircleAlert, CircleCheck } from 'lucide-react';
import { Toaster as Sonner, toast } from 'sonner';

/** Success lasts 6 s; an error stays until it is closed (P5). */
export const SUCCESS_TOAST_MS = 6000;

/**
 * The toasts (P5): bottom right, newest at the bottom, in the tokens' colours; × at the top right
 * inside the toast.
 */
export function Toaster({ theme }: { theme: 'light' | 'dark' | 'system' }) {
  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      closeButton
      duration={SUCCESS_TOAST_MS}
      // The tokens' outline icons, not Sonner's filled ones (handoff 33 §11).
      icons={{
        success: <CircleCheck aria-hidden className="size-4 text-success-foreground" />,
        error: <CircleAlert aria-hidden className="size-4 text-destructive" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            'bg-card text-card-foreground border border-border shadow-3 font-sans pr-10 [--toast-close-button-start:auto] [--toast-close-button-end:0.5rem] [--toast-close-button-transform:translateY(0.5rem)]',
          closeButton: 'border-0 bg-transparent text-muted-foreground hover:bg-muted',
          description: 'text-muted-foreground',
          error: 'border-destructive',
          // An outline button, as the page's own (Sonner's solid one by default).
          actionButton:
            '!border !border-input !bg-card !text-foreground hover:!bg-muted !font-medium !h-8 !px-3',
        },
      }}
    />
  );
}

export { toast };
