'use client';

import {
  accountRecoveriesCancel,
  emailChangeConfirmChange,
  emailChangeRevertChange,
  emailChangeVerify,
} from '@wayfare/api-client';
import { useEffect, useRef, useState } from 'react';
import { clearPageCookie, SIGNED_IN_MARKER } from '../client/cookies';
import { useConsole } from '../i18n/provider';
import {
  ActionLink,
  ExpiredLink,
  LinkWorking,
  ResultCard,
  signedInEmail,
  useLinkFragment,
} from './link';

/** The links that act at once, with no form (C4a–C4d). */
export type LinkKind = 'verify' | 'confirm' | 'revert' | 'cancelRecovery';

interface Answer {
  readonly emailMasked: string;
  readonly sameAccount: boolean;
}

/** Each link's call. Undoing a change and stopping a recovery answer nothing about the account. */
async function act(kind: LinkKind, token: string, id: string | null): Promise<Answer | null> {
  const options = { anonymous: true } as const;
  switch (kind) {
    case 'verify':
      return (await emailChangeVerify({ token }, options)).data;
    case 'confirm':
      return (await emailChangeConfirmChange({ token }, options)).data;
    case 'revert':
      return (await emailChangeRevertChange({ token }, options)).data;
    case 'cancelRecovery':
      if (id === null) throw new Error('no case');
      await accountRecoveriesCancel(id, { token }, options);
      return null;
  }
}

type Outcome =
  | { state: 'working' }
  | { state: 'expired' }
  | { state: 'done'; answer: Answer | null }
  | { state: 'otherAccount'; linkEmail: string; email: string };

/**
 * An emailed link that acts on opening (K8): one result, one next step. A link for another account
 * acts for that account and says who this browser is still signed in as (C4's L6).
 */
export function LinkAction({ kind }: { kind: LinkKind }) {
  const { t } = useConsole();
  const fragment = useLinkFragment();
  const [outcome, setOutcome] = useState<Outcome>({ state: 'working' });
  const started = useRef(false);

  useEffect(() => {
    if (fragment === null || started.current) return;
    started.current = true;
    const token = fragment.token;
    if (token === null) {
      setOutcome({ state: 'expired' });
      return;
    }
    void (async () => {
      try {
        const answer = await act(kind, token, fragment.id);
        // An undone change signs every device out, this one included.
        if (kind === 'revert') clearPageCookie(SIGNED_IN_MARKER);
        const email =
          answer !== null && !answer.sameAccount && kind !== 'revert'
            ? await signedInEmail()
            : null;
        setOutcome(
          email === null || answer === null
            ? { state: 'done', answer }
            : { state: 'otherAccount', linkEmail: answer.emailMasked, email },
        );
      } catch {
        setOutcome({ state: 'expired' });
      }
    })();
  }, [fragment, kind]);

  switch (outcome.state) {
    case 'working':
      return <LinkWorking />;
    case 'expired':
      return <ExpiredLink />;
    case 'otherAccount':
      return (
        <ResultCard
          title={t('link.otherAccount.title')}
          body={t('link.otherAccount.body', { linkEmail: outcome.linkEmail, email: outcome.email })}
          action={<ActionLink href="/">{t('link.toConsole')}</ActionLink>}
        />
      );
    case 'done': {
      const email = outcome.answer?.emailMasked ?? '';
      switch (kind) {
        case 'verify':
          return (
            <ResultCard
              title={t('link.verified.title')}
              body={t('link.verified.body', { email })}
              action={<ActionLink href="/">{t('link.toConsole')}</ActionLink>}
            />
          );
        case 'confirm':
          return (
            <ResultCard
              title={t('link.changed.title', { email })}
              body={t('link.changed.body')}
              action={<ActionLink href="/">{t('link.toConsole')}</ActionLink>}
            />
          );
        case 'revert':
          return (
            <ResultCard
              title={t('link.reverted.title')}
              body={t('link.reverted.body', { email })}
              action={<ActionLink href="/sign-in">{t('link.signIn')}</ActionLink>}
            />
          );
        case 'cancelRecovery':
          return (
            <ResultCard
              title={t('link.recoveryStopped.title')}
              body={t('link.recoveryStopped.body')}
            />
          );
      }
    }
  }
}
