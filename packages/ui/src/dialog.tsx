'use client';

import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useRef } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const overlay =
  'fixed inset-0 z-40 bg-overlay/50 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out';

/**
 * Where focus goes back to when a dialog closes: the element that had it when the dialog opened.
 * Radix returns it to a `Dialog.Trigger` only, and most dialogs open from state, not a trigger.
 */
function useFocusReturn(): Pick<
  ComponentProps<typeof DialogPrimitive.Content>,
  'onOpenAutoFocus' | 'onCloseAutoFocus'
> {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    },
    onCloseAutoFocus: (event) => {
      if (opener.current === null || !opener.current.isConnected) return;
      event.preventDefault();
      opener.current.focus();
    },
  };
}

/**
 * Round 00's web dialog: a scrim, focus trapped and returned, Escape and the × cancel. A fade and a
 * slight scale over `duration.fast`; at once under reduced motion.
 */
export function DialogContent({
  className,
  children,
  closeLabel,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { closeLabel: string }) {
  const focusReturn = useFocusReturn();
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(overlay, 'duration-(--duration-fast) motion-reduce:animate-none')}
      />
      <DialogPrimitive.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-3 outline-none duration-(--duration-fast) data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out motion-reduce:animate-none',
          className,
        )}
        {...focusReturn}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          aria-label={closeLabel}
          className="absolute top-4 right-4 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X aria-hidden className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({
  title,
  description,
}: {
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 pr-6">
      <DialogPrimitive.Title className="text-lg font-semibold text-foreground">
        {title}
      </DialogPrimitive.Title>
      {description === undefined ? (
        <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
      ) : (
        <DialogPrimitive.Description className="text-sm text-muted-foreground">
          {description}
        </DialogPrimitive.Description>
      )}
    </div>
  );
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{children}</div>;
}

/** The navigation's drawer below 1024 px (C9a): from the left, with its scrim; a Radix dialog. */
export function DrawerContent({
  className,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(overlay, 'duration-(--duration-normal) motion-reduce:animate-none')}
      />
      <DialogPrimitive.Content
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-72 max-w-full flex-col bg-card shadow-3 outline-none duration-(--duration-normal) data-[state=open]:animate-in data-[state=open]:slide-in-from-left data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left motion-reduce:animate-none',
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export const DrawerTitle = DialogPrimitive.Title;
