'use client';

import { ApiError, authGoogleLink, authGoogleSignIn, authLogin } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { Field, FormAlert, Input, PasswordInput } from '@wayfare/ui/field';
import { Card } from '@wayfare/ui/surfaces';
import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { errorText } from '../client/errors';
import { useConsole } from '../i18n/provider';
import { completeSignIn } from './complete-sign-in';

/** How long identity honours a link ticket (ADR 0064). */
const TICKET_MS = 5 * 60_000;

/** A `GOOGLE_LINK_NEEDS_PASSWORD` answer, held in memory only (K11). */
export interface LinkTicket {
  readonly linkTicket: string;
  readonly email: string;
  readonly at: number;
}

/** The address a Google ID token names — read for display; identity verified the token. */
function tokenEmail(idToken: string): string {
  try {
    const payload = idToken.split('.')[1] ?? '';
    const json = atob(payload.replaceAll('-', '+').replaceAll('_', '/'));
    const email = (JSON.parse(json) as { email?: unknown }).email;
    return typeof email === 'string' ? email : '';
  } catch {
    return '';
  }
}

/**
 * *Continue with Google* (K10, K11): a new account goes on to apply (N4), any other to `next`; an
 * address Google doesn't own that already has an account answers with a link ticket, which the
 * caller turns into N3.
 */
export function useGoogleContinue(next: string | null) {
  const translator = useConsole();
  const [ticket, setTicket] = useState<LinkTicket | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onCredential = useCallback(
    async (idToken: string) => {
      setBusy(true);
      setAlert(null);
      try {
        const { data } = await authGoogleSignIn(
          { idToken, preferredLocale: translator.locale },
          { anonymous: true },
        );
        completeSignIn(data.user, data.outcome === 'CREATED' ? '/owner/registration/apply' : next);
      } catch (error) {
        const details = error instanceof ApiError ? error.details : undefined;
        if (
          error instanceof ApiError &&
          error.code === 'GOOGLE_LINK_NEEDS_PASSWORD' &&
          typeof (details as { linkTicket?: unknown } | undefined)?.linkTicket === 'string'
        ) {
          setTicket({
            linkTicket: (details as { linkTicket: string }).linkTicket,
            email: tokenEmail(idToken),
            at: Date.now(),
          });
        } else {
          setAlert(errorText(error, translator));
        }
        setBusy(false);
      }
    },
    [next, translator],
  );

  /** The ticket ran out before the password came: back to the page, saying to try Google again. */
  const expire = useCallback(() => {
    setTicket(null);
    setAlert(translator.t('gLink.expired'));
  }, [translator]);

  return { ticket, alert, busy, onCredential, expire };
}

/**
 * Google's link (N3, N3b), in ADR 0064's order: the account's password signs in, then the ticket
 * links Google. A wrong password stays here; a ticket past its five minutes either sends the
 * visitor back to try Google again or, once signed in, says Google isn't linked yet.
 */
export function GoogleLinkStep({
  ticket,
  next,
  onExpired,
}: {
  ticket: LinkTicket;
  next: string | null;
  onExpired: () => void;
}) {
  const translator = useConsole();
  const { t } = translator;
  const [password, setPassword] = useState('');
  const [alert, setAlert] = useState<{ title: string; body?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [unlinked, setUnlinked] = useState<{ user: { preferredLocale: string } } | null>(null);
  const sending = useRef(false);

  const submit = async () => {
    if (sending.current) return;
    if (Date.now() - ticket.at > TICKET_MS) {
      onExpired();
      return;
    }
    sending.current = true;
    setBusy(true);
    setAlert(null);
    let user: { preferredLocale: string };
    try {
      ({
        data: { user },
      } = await authLogin({ email: ticket.email, password }, { anonymous: true }));
    } catch (error) {
      setAlert(
        error instanceof ApiError && error.code === 'INVALID_CREDENTIALS'
          ? { title: t('gLink.wrongTitle'), body: t('gLink.wrongBody') }
          : { title: errorText(error, translator) },
      );
      setBusy(false);
      sending.current = false;
      return;
    }
    try {
      await authGoogleLink({ linkTicket: ticket.linkTicket });
      completeSignIn(user, next);
    } catch {
      // Signed in, but the link didn't form (the ticket ran out meanwhile).
      setUnlinked({ user });
      setBusy(false);
    }
  };

  if (unlinked !== null) {
    return (
      <Card className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold text-foreground">{t('gLink.title')}</h1>
        <FormAlert>{t('gLink.notLinked')}</FormAlert>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={() => completeSignIn(unlinked.user, '/account')}>
            {t('gLink.openAccount')}
          </Button>
          <Button variant="outline" onClick={() => completeSignIn(unlinked.user, next)}>
            {t('gLink.continue')}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-foreground">{t('gLink.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('gLink.body', { email: ticket.email })}</p>
      </div>
      {alert === null ? null : (
        <FormAlert>
          <span className="block font-medium">{alert.title}</span>
          {alert.body}
        </FormAlert>
      )}
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label={t('gLink.account')}>
          {(control) => (
            <Input
              {...control}
              type="email"
              autoComplete="username"
              value={ticket.email}
              readOnly
              data-no-example
            />
          )}
        </Field>
        <Field label={t('field.password')}>
          {(control) => (
            <PasswordInput
              {...control}
              autoComplete="current-password"
              showLabel={t('password.show')}
              hideLabel={t('password.hide')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>
        <Button type="submit" busy={busy ? t('gLink.busy') : undefined} disabled={busy}>
          {t('gLink.submit')}
        </Button>
      </form>
      <Link
        href="/forgot-password"
        className="self-start rounded-sm px-3 text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t('signIn.forgot')}
      </Link>
      <p className="text-xs text-muted-foreground">{t('gLink.note')}</p>
    </Card>
  );
}
