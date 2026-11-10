'use client';

import {
  ApiError,
  authLogout,
  authRefresh,
  emailChangeConfirmChange,
  emailChangeRevertChange,
  emailChangeVerify,
} from '@wayfare/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { clearPageCookie } from '../client/cookies';
import { useWeb } from '../i18n/provider';
import { ME_KEY } from './me';
import { ACCOUNT_HINT_COOKIE } from '../session/account-hint';
import {
  ExpiredLink,
  LinkResult,
  LinkWorking,
  OtherAccount,
  ResultAction,
  signedInEmail,
  useLinkToken,
} from './link';

/** The links that act on opening (WE1, WE1c, WE1d). */
export type LinkKind = 'verify' | 'confirm' | 'revert';

interface Answer {
  readonly emailMasked: string;
  readonly sameAccount: boolean;
}

async function act(kind: LinkKind, token: string): Promise<Answer> {
  switch (kind) {
    case 'verify':
      return (await emailChangeVerify({ token }, { anonymous: true })).data;
    case 'confirm':
      return (await emailChangeConfirmChange({ token }, { anonymous: true })).data;
    case 'revert':
      return (await emailChangeRevertChange({ token }, { anonymous: true })).data;
  }
}

type Outcome =
  | { state: 'working' }
  | { state: 'expired' }
  | { state: 'done'; answer: Answer }
  | { state: 'otherAccount'; other: string; email: string };

/**
 * An emailed link that acts at once (K8): its result and one next step. A link for another account
 * than the one signed in here says so, and that signing out comes first (WE1f).
 */
export function LinkAction({ kind }: { kind: LinkKind }) {
  const { t } = useWeb();
  const queries = useQueryClient();
  const token = useLinkToken();
  const [outcome, setOutcome] = useState<Outcome>({ state: 'working' });
  const started = useRef(false);

  useEffect(() => {
    if (token === undefined || started.current) return;
    started.current = true;
    if (token === null) {
      setOutcome({ state: 'expired' });
      return;
    }
    void (async () => {
      try {
        const answer = await act(kind, token);
        // An undone change signs every session out, this browser's too: its own cookies go now, and
        // the header says so at once. A read of who is signed in already on its way is cancelled
        // first — the revoked session still answers it for a moment, until the gateway's cached
        // cutoff catches up, and its answer would put the account back.
        if (kind === 'revert') {
          await queries.cancelQueries({ queryKey: ME_KEY });
          await authLogout({}).catch(() => undefined);
          clearPageCookie(ACCOUNT_HINT_COOKIE);
          queries.setQueryData(ME_KEY, null);
        }
        if (answer.sameAccount && kind === 'verify') await authRefresh({}).catch(() => undefined);
        const email = !answer.sameAccount && kind !== 'revert' ? await signedInEmail() : null;
        setOutcome(
          email === null
            ? { state: 'done', answer }
            : { state: 'otherAccount', other: answer.emailMasked, email },
        );
      } catch (error) {
        setOutcome(error instanceof ApiError ? { state: 'expired' } : { state: 'expired' });
      }
    })();
  }, [token, kind, queries]);

  switch (outcome.state) {
    case 'working':
      return <LinkWorking />;
    case 'expired':
      return <ExpiredLink />;
    case 'otherAccount':
      return <OtherAccount email={outcome.email} other={outcome.other} />;
    case 'done': {
      const email = outcome.answer.emailMasked;
      switch (kind) {
        case 'verify':
          return (
            <LinkResult
              title={t('link.verifiedTitle')}
              body={t('link.verifiedBody', { email })}
              action={<ResultAction href="/favourites">{t('link.done')}</ResultAction>}
            />
          );
        case 'confirm':
          return (
            <LinkResult
              title={t('link.confirmedTitle')}
              body={t('link.confirmedBody', { email })}
              action={<ResultAction href="/account">{t('link.done')}</ResultAction>}
            />
          );
        case 'revert':
          return (
            <LinkResult
              icon={Undo2}
              title={t('link.revertedTitle', { email })}
              body={t('link.revertedBody')}
              action={<ResultAction href="/sign-in">{t('link.signIn')}</ResultAction>}
            />
          );
      }
    }
  }
}
