import type { ComponentProps } from 'react';
import { cn } from './cn';

/**
 * Round 33's *Google button (web)*: 40 px, Roboto Medium 14, the *G* at 18, in round 31a's Google
 * colours. The console shows Google's own Identity Services button where Google is reachable; this
 * one stands in where it is not — the development stack's test issuer. The page's app serves the
 * *G* at `/brand/google-g.svg`.
 */
export function GoogleButton({ className, children, ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-10 w-full items-center justify-center gap-3 rounded-md border border-google-button-border bg-google-button px-3 text-sm font-medium text-google-button-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {/* Google's own *G*, in Google's colours (its brand rules): the app serves it as a file. */}
      <img src="/brand/google-g.svg" alt="" width={18} height={18} />
      {children}
    </button>
  );
}
