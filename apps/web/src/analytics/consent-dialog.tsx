'use client';

import type { Question } from '@wayfare/core';
import { Button } from '@wayfare/ui/button';
import { CircleCheck, CircleX } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useWeb } from '../i18n/provider';
import { player } from '../player/player';
import { useAnalytics } from './use-analytics';

/** A policy version (`YYYY-MM-DD`) as a date in the reader's language. */
function policyDate(version: string, locale: string): string {
  const date = new Date(`${version}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? version
    : new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(date);
}

/**
 * The question on the web (AC3), and a new policy's (AC5): a sheet on a phone, a centred 480 px
 * dialog from 720 px. Not a cookie banner — asked after a story, never on arrival. Equal choices,
 * neither pre-selected; Escape, the scrim and closing choose nothing. Focus starts on the title and
 * returns to the player.
 */
export function ConsentDialog({
  variant,
  policyVersion,
  onAllow,
  onNoThanks,
  onClose,
}: {
  variant: Exclude<Question, null>;
  policyVersion: string;
  onAllow: () => void;
  onNoThanks: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useWeb();
  const title = useRef<HTMLHeadingElement>(null);
  const changed = variant === 'changed';
  const summary =
    t('consent.changed.version') === policyVersion ? t('consent.changed.summary') : null;
  const date = policyDate(policyVersion, locale);
  const row = (Icon: typeof CircleCheck, text: string, tone: string) => (
    <li key={text} className="flex items-start gap-2 text-sm text-card-foreground">
      <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${tone}`} />
      <span>{text}</span>
    </li>
  );
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-overlay/50 data-[state=open]:animate-in data-[state=open]:fade-in motion-reduce:animate-none" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            title.current?.focus();
          }}
          data-testid="consent-dialog"
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-dvh w-full flex-col gap-4 overflow-y-auto rounded-t-2xl bg-card p-6 pt-2 text-card-foreground shadow-3 outline-none duration-(--duration-normal) data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom motion-reduce:animate-none tablet:inset-x-auto tablet:top-1/2 tablet:bottom-auto tablet:left-1/2 tablet:w-120 tablet:-translate-x-1/2 tablet:-translate-y-1/2 tablet:rounded-2xl tablet:pt-6 tablet:data-[state=open]:slide-in-from-bottom-0 tablet:data-[state=open]:zoom-in-95"
        >
          <div aria-hidden className="flex justify-center tablet:hidden">
            <span className="h-1 w-9 rounded-full bg-border" />
          </div>
          <DialogPrimitive.Title
            ref={title}
            tabIndex={-1}
            className="text-2xl font-semibold text-card-foreground outline-none"
          >
            {changed ? t('consent.changed.title') : t('consent.title')}
          </DialogPrimitive.Title>
          <p className="text-base text-card-foreground">
            {changed
              ? summary === null
                ? t('consent.changed.leadPlain', { date })
                : t('consent.changed.lead', { date, summary })
              : t('consent.lead')}
          </p>
          <ul className="flex flex-col gap-2">
            {row(CircleCheck, t('consent.counted.stories'), 'text-primary')}
            {row(CircleCheck, t('consent.counted.language'), 'text-primary')}
            {row(CircleCheck, t('consent.counted.square'), 'text-primary')}
          </ul>
          <ul className="flex flex-col gap-2">
            {row(CircleX, t('consent.never.person'), 'text-muted-foreground')}
            {row(CircleX, t('consent.never.cookies'), 'text-muted-foreground')}
          </ul>
          {changed ? (
            <p className="text-sm font-medium text-card-foreground">{t('consent.changed.until')}</p>
          ) : null}
          <div className="flex gap-3">
            <Button variant="secondary" size="lg" className="flex-1" onClick={onNoThanks}>
              {t('consent.noThanks')}
            </Button>
            <Button variant="secondary" size="lg" className="flex-1" onClick={onAllow}>
              {t('consent.allow')}
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-y-1 text-xs">
            <span className="text-muted-foreground">{t('consent.footer')}</span>
            <Link href="/privacy" className="text-primary underline">
              {t('consent.privacyPolicy')}
            </Link>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** The pages a story plays on: the question waits for one of them. */
const STORY_PAGES = /^\/(p|t|map)(\/|$)/;

/**
 * Shows the owed question on the page where the story played (K7, K8) — a Place's page, the map, a
 * tour — once the player is idle. Once shown it stays until a choice or a close; a choice is acted
 * on once, however many clicks.
 */
export function ConsentHost() {
  const live = useAnalytics();
  const path = usePathname();
  const phase = useSyncExternalStore(
    player.subscribe,
    () => player.getState().phase,
    () => 'idle' as const,
  );
  const idle = phase === 'idle' || phase === 'paused' || phase === 'unavailable';
  const [shown, setShown] = useState<Exclude<Question, null> | null>(null);
  const acted = useRef(false);
  // The question just answered stays answered until the client's snapshot says so.
  const answered = useRef<Question>(null);
  const question = live?.snapshot.question ?? null;
  if (question === null) answered.current = null;
  useEffect(() => {
    if (question !== null && question === answered.current) return;
    if (shown === null && question !== null && idle && STORY_PAGES.test(path)) {
      acted.current = false;
      setShown(question);
    }
  }, [shown, question, idle, path]);
  if (live === null || shown === null) return null;
  const act = (choice: () => Promise<void>) => {
    if (acted.current) return;
    acted.current = true;
    answered.current = shown;
    setShown(null);
    void choice();
  };
  return (
    <ConsentDialog
      variant={shown}
      policyVersion={live.snapshot.state.knownPolicyVersion}
      onAllow={() => act(() => live.client.allow())}
      onNoThanks={() => act(() => live.client.withdraw())}
      onClose={() => act(() => live.client.closeQuestion())}
    />
  );
}
