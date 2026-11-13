import { ApiError } from '@wayfare/api-client';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CircleCheck, Clock, ShieldCheck, User } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  openLink,
  resendVerification,
  resetPassword,
  validateReset,
} from '../../src/account/actions';
import type { LinkAnswer } from '../../src/account/actions';
import { ErrorBanner, FormBody, LinkResult } from '../../src/account/components';
import { formErrorOf, passwordTooShort } from '../../src/account/form-errors';
import type { FormError } from '../../src/account/form-errors';
import { afterReset, linkResultOf } from '../../src/account/links';
import type { LinkPage, LinkResult as Result } from '../../src/account/links';
import { useSubmit } from '../../src/account/use-form';
import { errorMessage } from '../../src/i18n';
import { useTourist } from '../../src/i18n/use-tourist';
import { useAccountStore } from '../../src/session/account-store';
import { Button } from '../../src/ui/button';
import { ScreenHeader } from '../../src/ui/screen-header';
import { SkeletonRows } from '../../src/ui/skeleton';
import { TextField } from '../../src/ui/text-field';
import { showToast } from '../../src/ui/toast';
import { FormScroll } from '../../src/ui/form-scroll';

const expired = (error: unknown) => error instanceof ApiError && error.code === 'TOKEN_EXPIRED';

type State =
  | { kind: 'loading' }
  | { kind: 'result'; result: Result; answer: LinkAnswer | null }
  | { kind: 'reset'; answer: LinkAnswer }
  | { kind: 'failed'; message: string };

/**
 * An emailed link opened in the app (frames L1–L6, K8–K10): one call, one result. The link acts
 * for its own account and never changes who is signed in here, except a revert of this account.
 */
export default function AccountLinkScreen() {
  const { t } = useTourist();
  const router = useRouter();
  const { page, token } = useLocalSearchParams<{ page: LinkPage; token: string }>();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        if (page === 'reset') {
          const answer = await validateReset(token);
          if (live) setState({ kind: 'reset', answer });
          return;
        }
        const answer = await openLink(page, token);
        if (live)
          setState({ kind: 'result', result: linkResultOf(page, answer, answer.signedIn), answer });
      } catch (error) {
        if (!live) return;
        setState(
          expired(error)
            ? { kind: 'result', result: 'expired', answer: null }
            : { kind: 'failed', message: errorMessage(error) },
        );
      }
    })();
    return () => {
      live = false;
    };
  }, [page, token]);

  const done = () => router.dismissTo('/settings');
  const body = () => {
    switch (state.kind) {
      case 'loading':
        return <SkeletonRows count={2} />;
      case 'failed':
        return (
          <FormBody>
            <ErrorBanner title={state.message} />
          </FormBody>
        );
      case 'reset':
        return <ResetForm answer={state.answer} token={token} />;
      case 'result':
        return resultFor(state);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScreenHeader title="" type="back" />
      <FormScroll>{body()}</FormScroll>
    </SafeAreaView>
  );

  /** A result screen. The signed-in address names this account; the link's masked one, another. */
  function resultFor(shown: Extract<State, { kind: 'result' }>) {
    const finish = done;
    const email = shown.answer?.emailMasked ?? '';
    const signedInAs = useAccountStore.getState().user?.email ?? '';
    switch (shown.result) {
      case 'verified':
        return (
          <LinkResult
            icon={CircleCheck}
            title={t('account.link.verified.title')}
            body={t('account.link.verified.body', { email: signedInAs || email })}
            primary={{ label: t('account.done'), onPress: finish }}
          />
        );
      case 'confirmed':
        return (
          <LinkResult
            icon={CircleCheck}
            title={t('account.link.confirmed.title', { email: signedInAs || email })}
            body={t('account.link.confirmed.body')}
            primary={{ label: t('account.done'), onPress: finish }}
          />
        );
      case 'reverted':
        return (
          <LinkResult
            icon={ShieldCheck}
            title={t('account.link.reverted.title')}
            body={t('account.link.reverted.body', { email })}
            primary={{
              label: t('account.signIn'),
              onPress: () => router.replace('/account/sign-in'),
            }}
          />
        );
      case 'other-account':
        return (
          <LinkResult
            icon={User}
            tone="muted-foreground"
            title={t('account.link.other.title')}
            body={t('account.link.other.body', { linkEmail: email, email: signedInAs })}
            primary={{ label: t('account.done'), onPress: finish }}
          />
        );
      case 'expired':
        return (
          <LinkResult
            icon={Clock}
            tone="warning-foreground"
            title={t('account.link.expired.title')}
            body={t('account.link.expired.body')}
            primary={{
              label: t('account.link.expired.newLink'),
              onPress: () => {
                // A verification is sent again for the signed-in account; any other link starts
                // from the form that asks for it.
                if (page === 'verify' && useAccountStore.getState().user !== null) {
                  void resendVerification()
                    .then(() => showToast(t('account.notice.verify.title')))
                    .catch((error: unknown) => showToast(errorMessage(error)));
                  finish();
                } else {
                  router.replace(page === 'reset' ? '/account/forgot' : '/account/sign-in');
                }
              },
            }}
            secondary={{ label: t('account.link.expired.notNow'), onPress: finish }}
          />
        );
    }
  }
}

/** Frame L2: one new password, then *Save and sign in* — whose outcome depends on who is here (K9). */
function ResetForm({ answer, token }: { answer: LinkAnswer; token: string }) {
  const { t } = useTourist();
  const router = useRouter();
  const { submit, running, offline } = useSubmit();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<FormError | null>(null);
  const [other, setOther] = useState(false);

  const save = () =>
    submit(async () => {
      const short = passwordTooShort(password, t);
      setError(short);
      if (short !== null) return;
      const next = afterReset(answer.sameAccount, answer.signedIn);
      try {
        await resetPassword(token, password, next === 'sign-in-again');
        if (next === 'sign-in-again') {
          showToast(t('account.link.reset.done'));
          router.dismissTo('/settings');
        } else if (next === 'sign-in-screen') {
          router.replace({ pathname: '/account/sign-in', params: { note: 'reset' } });
        } else {
          setOther(true);
        }
      } catch (caught) {
        if (expired(caught)) {
          setError({ place: 'banner', title: t('account.link.expired.title') });
          return;
        }
        setError(
          formErrorOf('reset', caught, t) ?? { place: 'banner', title: errorMessage(caught) },
        );
      }
    });

  if (other) {
    return (
      <LinkResult
        icon={User}
        tone="muted-foreground"
        title={t('account.link.other.title')}
        body={t('account.link.other.body', {
          linkEmail: answer.emailMasked,
          email: useAccountStore.getState().user?.email ?? '',
        })}
        primary={{ label: t('account.done'), onPress: () => router.dismissTo('/settings') }}
      />
    );
  }
  return (
    <FormBody>
      <Text accessibilityRole="header" className="text-display text-foreground">
        {t('account.link.reset.title')}
      </Text>
      <Text className="text-body text-muted-foreground">
        {t('account.link.reset.for', { email: answer.emailMasked })}
      </Text>
      {error?.place === 'banner' && <ErrorBanner title={error.title} body={error.body} />}
      <TextField
        testID="reset-password"
        label={t('account.field.newPassword')}
        value={password}
        onChangeText={setPassword}
        secure
        showLabel={t('account.password.show')}
        hideLabel={t('account.password.hide')}
        autoComplete="password-new"
        helper={t('account.field.passwordHint')}
        error={error?.place === 'password' ? error.title : null}
      />
      <Button
        testID="reset-submit"
        label={t('account.link.reset.submit')}
        onPress={() => void save()}
        loading={running}
        disabled={offline || password === ''}
      />
    </FormBody>
  );
}
