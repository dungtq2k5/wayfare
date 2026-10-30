'use client';

import { CircleAlert, Eye, EyeOff } from 'lucide-react';
import { Label as LabelPrimitive } from 'radix-ui';
import { useId, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';

const control =
  'w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors duration-(--duration-fast) focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 aria-invalid:border-destructive motion-reduce:transition-none';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(control, 'h-9', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(control, 'min-h-24 py-2', className)} {...props} />;
}

export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn('text-sm font-medium text-foreground', className)}
      {...props}
    />
  );
}

/** Round 33's password input: round 00's input plus *Show* / *Hide*, named for screen readers. */
export function PasswordInput({
  showLabel,
  hideLabel,
  className,
  ...props
}: Omit<ComponentProps<'input'>, 'type'> & { showLabel: string; hideLabel: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input type={shown ? 'text' : 'password'} className={cn('pr-10', className)} {...props} />
      <button
        type="button"
        onClick={() => setShown((value) => !value)}
        aria-label={shown ? hideLabel : showLabel}
        aria-pressed={shown}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-md text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {shown ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
      </button>
    </div>
  );
}

/** What a field's control needs from its `Field`: an id, and the ids that describe it. */
export interface FieldControl {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  'aria-required'?: true;
}

/**
 * A labelled field (P3): `*` for a required one, help under it, and its error beside it with the
 * error icon — the control is described by both.
 */
export function Field({
  label,
  required = false,
  help,
  error,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  help?: string | undefined;
  error?: string | undefined;
  className?: string;
  children: (control: FieldControl) => ReactNode;
}) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [help === undefined ? null : helpId, error === undefined ? null : errorId]
    .filter((value) => value !== null)
    .join(' ');
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span aria-hidden className="ml-1 text-destructive">
            *
          </span>
        ) : null}
      </Label>
      {children({
        id,
        ...(describedBy === '' ? {} : { 'aria-describedby': describedBy }),
        ...(error === undefined ? {} : { 'aria-invalid': true }),
        ...(required ? { 'aria-required': true } : {}),
      })}
      {help === undefined ? null : (
        <p id={helpId} className="text-xs text-muted-foreground">
          {help}
        </p>
      )}
      {error === undefined ? null : <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}

/** The one line above a form or a sign-in card (C1b, P3): its failure, said once. */
/** A field's error with its icon, for a group that isn't one `Field` (a checkbox list, a map). */
export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="flex items-center gap-1 text-xs text-destructive">
      <CircleAlert aria-hidden className="size-3 shrink-0" />
      {children}
    </p>
  );
}

export function FormAlert({
  children,
  action,
  className,
}: {
  children: ReactNode;
  /** Buttons: at the alert's right end, under the text at phone width (handoff 35 §14). */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-md border border-destructive bg-card px-4 py-3 text-sm text-destructive',
        className,
      )}
    >
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>{children}</div>
        {action === undefined ? null : (
          <div className="flex shrink-0 flex-wrap gap-2">{action}</div>
        )}
      </div>
    </div>
  );
}
