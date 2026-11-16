'use client';

import { authLogout, usersMe } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { CircleCheck, Link2Off, UserRoundX } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { clearPageCookie, readPageCookie } from '../client/cookies';
import { useWeb } from '../i18n/provider';
import { ACCOUNT_HINT_COOKIE } from '../session/account-hint';

/**
 * Reads `#token=` once, then strips the fragment from the address bar, so the token is neither
 * bookmarked nor shown (K8). `undefined` until read; `null` when the link carries none.
 */
export function useLinkToken(): string | null | undefined {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const read = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (read.current === undefined) {
      read.current = new URLSearchParams(window.location.hash.slice(1)).get('token');
      if (window.location.hash !== '')
        window.history.replaceState(
          null,
          '',
          `${window.location.pathname}${window.location.search}`,
        );
    }
    setToken(read.current);
  }, []);
  return token;
}

/** Who this browser is signed in as, when a link answered for another account; `null` if no one. */
export async function signedInEmail(): Promise<string | null> {
  if (readPageCookie(ACCOUNT_HINT_COOKIE) === null) return null;
  return usersMe().then(
    ({ data }) => data.user.email,
    () => null,
  );
}

/**
 * One result and one next step (round 31's L1–L6 as pages): the heading takes focus on load, so a
 * screen reader starts there.
 */
export function LinkResult({
  icon: Icon = CircleCheck,
  title,
  body,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 px-4 py-12 text-center">
      <span
        aria-hidden
        className={`flex size-14 items-center justify-center rounded-full bg-muted ${
          Icon === CircleCheck ? 'text-primary' : 'text-muted-foreground'
        }`}
      >
        <Icon className="size-7" />
      </span>
      <h1
        ref={heading}
        tabIndex={-1}
        className="text-2xl font-semibold text-foreground outline-none"
      >
        {title}
      </h1>
      <p className="text-base text-muted-foreground">{body}</p>
      {action === undefined ? null : <div className="mt-2 w-full">{action}</div>}
    </div>
  );
}

/** A result's one next step. */
export function ResultAction({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button asChild size="lg" className="w-full">
      <Link href={href}>{children}</Link>
    </Button>
  );
}

/** WE1e: expired and already-used links share one message. */
export function ExpiredLink() {
  const { t } = useWeb();
  return (
    <LinkResult
      icon={Link2Off}
      title={t('link.expiredTitle')}
      body={t('link.expiredBody')}
      action={<ResultAction href="/account">{t('link.newLink')}</ResultAction>}
    />
  );
}

/** WE1f: a link for another account — nothing done; sign out first. */
export function OtherAccount({ email, other }: { email: string; other: string }) {
  const { t } = useWeb();
  return (
    <LinkResult
      icon={UserRoundX}
      title={t('link.otherTitle')}
      body={t('link.otherBody', { email, other })}
      action={
        <Button
          size="lg"
          className="w-full"
          onClick={() =>
            void authLogout({}).finally(() => {
              clearPageCookie(ACCOUNT_HINT_COOKIE);
              window.location.reload();
            })
          }
        >
          {t('link.signOut')}
        </Button>
      }
    />
  );
}

/** While a link's call runs. */
export function LinkWorking() {
  const { t } = useWeb();
  return (
    <p role="status" className="px-4 py-12 text-center text-sm text-muted-foreground">
      {t('link.working')}
    </p>
  );
}
