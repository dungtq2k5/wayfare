'use client';

import { usersMe } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { Card } from '@wayfare/ui/surfaces';
import { CircleCheck, Link2Off } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { readPageCookie, SIGNED_IN_MARKER } from '../client/cookies';
import { useConsole } from '../i18n/provider';

/** What an emailed link carries in its fragment, which never reaches a server (K8). */
export interface LinkFragment {
  readonly token: string | null;
  readonly id: string | null;
}

/**
 * Reads `#token=` (and `#id=`) once, then strips the fragment from the address bar, so the token
 * is neither bookmarked nor shown. `null` until read.
 */
export function useLinkFragment(): LinkFragment | null {
  const [fragment, setFragment] = useState<LinkFragment | null>(null);
  // Read once: a second run of the effect comes after the fragment is gone.
  const read = useRef<LinkFragment | null>(null);
  useEffect(() => {
    if (read.current === null) {
      const params = new URLSearchParams(window.location.hash.slice(1));
      read.current = { token: params.get('token'), id: params.get('id') };
      if (window.location.hash !== '') {
        window.history.replaceState(
          null,
          '',
          `${window.location.pathname}${window.location.search}`,
        );
      }
    }
    setFragment(read.current);
  }, []);
  return fragment;
}

/**
 * Who this browser is signed in as, when a link answered for another account (K8, `sameAccount`
 * false): `null` when it holds no session.
 */
export async function signedInEmail(): Promise<string | null> {
  if (readPageCookie(SIGNED_IN_MARKER) === null) return null;
  return usersMe().then(
    ({ data }) => data.user.email,
    () => null,
  );
}

/** One result and one next step (C4a–C4f). */
export function ResultCard({
  tone = 'done',
  title,
  body,
  action,
}: {
  tone?: 'done' | 'expired';
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <Card className="flex flex-col items-start gap-3">
      <span
        aria-hidden
        className={
          tone === 'done'
            ? 'flex size-10 items-center justify-center rounded-full bg-success text-success-foreground'
            : 'flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground'
        }
      >
        {tone === 'done' ? <CircleCheck className="size-5" /> : <Link2Off className="size-5" />}
      </span>
      <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
      {action === undefined ? null : <div className="mt-2 w-full">{action}</div>}
    </Card>
  );
}

/** C4f: expired and already-used links share one message. */
export function ExpiredLink() {
  const { t } = useConsole();
  return (
    <ResultCard
      tone="expired"
      title={t('link.expired.title')}
      body={t('link.expired.body')}
      action={<ActionLink href="/sign-in">{t('forgot.back')}</ActionLink>}
    />
  );
}

/** A result's one next step. */
export function ActionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button asChild className="w-full">
      <Link href={href}>{children}</Link>
    </Button>
  );
}

/** While a link's call runs: the card's place, said in words. */
export function LinkWorking() {
  const { t } = useConsole();
  return (
    <Card role="status" className="text-sm text-muted-foreground">
      {t('link.working')}
    </Card>
  );
}
