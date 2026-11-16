'use client';

import { cn } from '@wayfare/ui/cn';
import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useRef } from 'react';
import type { ReactNode } from 'react';

/**
 * The web's bottom sheet (the handoff's §3, drawn on the page): it touches the window's bottom edge,
 * full width on a phone and 560 px centred from 720 px, with its handle; a dialog — Escape, the ×
 * or the scrim close it, and focus returns to what opened it.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  titleHidden = false,
  closeLabel,
  children,
  className,
  modal = true,
  focusSheet = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  titleHidden?: boolean;
  closeLabel?: string;
  children: ReactNode;
  className?: string;
  modal?: boolean;
  /**
   * Focus the sheet itself as it opens, not its first button: Radix skips links for the first
   * focus, so a sheet whose first action is a link would open on the lesser one after it.
   */
  focusSheet?: boolean;
}) {
  const content = useRef<HTMLDivElement>(null);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <DialogPrimitive.Portal>
        {modal ? (
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-overlay/50 data-[state=open]:animate-in data-[state=open]:fade-in motion-reduce:animate-none" />
        ) : null}
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onInteractOutside={modal ? undefined : (event) => event.preventDefault()}
          onOpenAutoFocus={
            focusSheet
              ? (event) => {
                  event.preventDefault();
                  content.current?.focus();
                }
              : undefined
          }
          ref={content}
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-dvh w-full flex-col gap-4 overflow-y-auto rounded-t-2xl bg-card px-4 pt-2 pb-4 text-card-foreground shadow-3 outline-none duration-(--duration-normal) data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom motion-reduce:animate-none tablet:w-140',
            className,
          )}
        >
          <span aria-hidden className="mx-auto h-1 w-9 shrink-0 rounded-full bg-border" />
          <div className="flex items-center gap-2">
            <DialogPrimitive.Title
              className={cn(
                'flex-1 text-lg font-semibold text-foreground',
                titleHidden && 'sr-only',
              )}
            >
              {title}
            </DialogPrimitive.Title>
            {closeLabel === undefined ? null : (
              <DialogPrimitive.Close
                aria-label={closeLabel}
                className="ml-auto flex size-11 items-center justify-center rounded-md text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X aria-hidden className="size-6" />
              </DialogPrimitive.Close>
            )}
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
