'use client';

import { Check, Copy, RotateCw } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from './button';
import { cn } from './cn';

/** The empty state (web): also the base of no-results, 403 and 404. */
export function EmptyState({
  icon,
  title,
  body,
  action,
  headingLevel = 2,
  className,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
  /** 1 when the state is the whole page (C14, C15). */
  headingLevel?: 1 | 2;
  className?: string;
}) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  return (
    <div
      className={cn(
        'mx-auto flex max-w-md flex-col items-center gap-2 py-12 text-center',
        className,
      )}
    >
      <span
        aria-hidden
        className="mb-2 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-6"
      >
        {icon}
      </span>
      <Heading className="text-lg font-semibold text-foreground">{title}</Heading>
      <p className="text-sm text-muted-foreground">{body}</p>
      {action === undefined ? null : <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * The error state (C13): replaces only what the request would have filled. Its code's text, the
 * request ID with *Copy* (support traces it), and *Try again*.
 */
export function ErrorState({
  icon,
  title,
  message,
  requestId,
  labels,
  onRetry,
}: {
  icon: ReactNode;
  title: string;
  message: string;
  requestId?: string | undefined;
  labels: { requestId: string; copy: string; copied: string; retry: string };
  onRetry?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      role="alert"
      className="mx-auto flex max-w-md flex-col items-center gap-2 py-12 text-center"
    >
      <span
        aria-hidden
        className="mb-2 flex size-12 items-center justify-center rounded-full bg-muted text-destructive [&_svg]:size-6"
      >
        {icon}
      </span>
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="text-sm text-muted-foreground">{message}</p>
      {requestId === undefined ? null : (
        <div className="mt-2 flex items-center gap-2 rounded-md bg-muted px-3 py-1 text-xs">
          <span className="text-muted-foreground">{labels.requestId}</span>
          <code className="font-mono text-foreground">{requestId}</code>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2"
            onClick={() => {
              void navigator.clipboard.writeText(requestId).then(() => setCopied(true));
            }}
          >
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? labels.copied : labels.copy}
          </Button>
        </div>
      )}
      {onRetry === undefined ? null : (
        <Button variant="outline" className="mt-4" onClick={onRetry}>
          <RotateCw aria-hidden />
          {labels.retry}
        </Button>
      )}
    </div>
  );
}

/** The console banner (C16, C17): full width under the bar, one at a time. */
export function Banner({
  tone,
  icon,
  message,
  action,
}: {
  tone: 'offline' | 'warning' | 'error' | 'info';
  icon: ReactNode;
  message: string;
  action?: ReactNode;
}) {
  const tones = {
    offline: 'bg-offline text-offline-foreground',
    warning: 'bg-warning text-warning-foreground',
    error: 'bg-destructive text-destructive-foreground',
    info: 'bg-info text-info-foreground',
  } as const;
  return (
    <div
      role="status"
      data-tone={tone}
      className={cn(
        'flex flex-wrap items-center gap-3 px-6 py-2 text-sm [&_svg]:size-4 [&_svg]:shrink-0',
        tones[tone],
      )}
    >
      {icon}
      <p className="min-w-0 flex-1">{message}</p>
      {action}
    </div>
  );
}
