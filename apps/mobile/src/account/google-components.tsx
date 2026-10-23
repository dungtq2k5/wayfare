import { useRouter } from 'expo-router';
import { CircleAlert, CircleCheck } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { GoogleOutcome } from '@wayfare/contracts';
import { PRIVACY_POLICY_URL, TERMS_URL } from '../env';
import { useTourist } from '../i18n/use-tourist';
import type { TouristT } from '../i18n/tourist';
import { useAccountStore } from '../session/account-store';
import type { AccountUser } from '../session/account-store';
import { Icon } from '../theme/icon';
import { GoogleButton, GoogleG, OrDivider } from '../ui/google-button';
import { InlineNote } from '../ui/inline-note';
import { showToast } from '../ui/toast';
import { errorMessage } from '../i18n';
import { forgotPassword } from './actions';
import { confirmWithGoogle, continueWithGoogle } from './google';
import type { GoogleFailure } from './google-failures';
import type { ItsYou } from './actions';
import { signedInCount } from './rules';

/** The line each failure says under the button (frames K8b, K8c, revision 2's three). */
const FAILURE_LINE = {
  unreachable: 'account.google.unreachable',
  unavailable: 'account.google.unreachable',
  'not-verified': 'account.google.notVerified',
  'not-allowed': 'account.google.notAllowed',
  'already-linked': 'account.google.alreadyLinked',
  deactivated: 'account.google.deactivated',
} as const satisfies Record<Exclude<GoogleFailure, 'no-account'>, string>;

/** An error line in the error colour, with its icon (the handoff's error style). */
function ErrorLine({ text }: { text: string }) {
  return (
    <View accessibilityLiveRegion="polite" className="flex-row items-center gap-1">
      <Icon icon={CircleAlert} size="xs" color="destructive" />
      <Text className="flex-1 text-caption text-destructive">{text}</Text>
    </View>
  );
}

/** The toast an outcome says (frames K5a, K5b): created, or round 31's signed-in count. */
function outcomeToast(t: TouristT, outcome: GoogleOutcome, favourites: number): string {
  if (outcome === GoogleOutcome.CREATED) return t('account.created');
  const count = signedInCount(favourites);
  return count === null ? t('account.signedIn.plain') : t('account.signedIn', { count });
}

/**
 * The top of *Create an account* and *Sign in* (frames K1, K2): *Continue with Google* first, the
 * terms its tap accepts, then "or" above the email form. Every answer has its screen (K14): a
 * toast and back, the password step (K9), a line under the button, or nothing for a cancel.
 * Offline and rate limits go to `onError`, which the form shows as its own.
 */
export function GoogleSection({
  offline,
  onBusy,
  onError,
}: {
  offline: boolean;
  /** The email form rests while Google answers (frame K3b). */
  onBusy: (busy: boolean) => void;
  onError: (error: unknown) => void;
}) {
  const { t } = useTourist();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<GoogleFailure | null>(null);
  const running = useRef(false);

  const go = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    onBusy(true);
    setFailure(null);
    try {
      const answer = await continueWithGoogle();
      if (answer.kind === 'signed-in') {
        showToast(outcomeToast(t, answer.outcome, answer.favourites));
        router.back();
        if (answer.needsTerms) router.push('/account/terms');
      } else if (answer.kind === 'needs-password') {
        router.replace({
          pathname: '/account/google-link',
          params: { email: answer.email, ticket: answer.linkTicket },
        });
      } else if (answer.kind === 'failed') {
        setFailure(answer.reason);
      }
    } catch (error) {
      onError(error);
    } finally {
      running.current = false;
      setBusy(false);
      onBusy(false);
    }
  };

  const link = (label: string, url: string) => (
    <Text
      accessibilityRole="link"
      className="text-label text-primary underline"
      onPress={() => void Linking.openURL(url)}
    >
      {label}
    </Text>
  );

  return (
    <View className="gap-3">
      <GoogleButton
        testID="google-continue"
        label={t('account.google.continue')}
        busyLabel={t('account.google.busy')}
        loading={busy}
        disabled={offline}
        onPress={() => void go()}
      />
      {failure === 'no-account' && <InlineNote text={t('account.google.noAccount')} />}
      {failure !== null && failure !== 'no-account' && (
        <ErrorLine text={t(FAILURE_LINE[failure])} />
      )}
      <Text className="text-label text-muted-foreground">
        {t('account.google.terms.before')} {link(t('account.google.terms.terms'), TERMS_URL)}{' '}
        {t('account.google.terms.and')}{' '}
        {link(t('account.google.terms.privacy'), PRIVACY_POLICY_URL)}.
      </Text>
      <OrDivider label={t('account.google.or')} />
    </View>
  );
}

/** How the account signs in, under its address (frames A1g, A1g2): a small *G* and a line. */
export function SignedInWith({ user }: { user: AccountUser }) {
  const { t } = useTourist();
  if (user.signIn?.google !== true) return null;
  return (
    <View className="flex-row items-center gap-2">
      <GoogleG size={16} />
      <Text className="flex-1 text-label text-muted-foreground">
        {user.signIn.password ? t('account.signInWith.both') : t('account.signInWith.google')}
      </Text>
    </View>
  );
}

/**
 * Where a password-less account would give its password (frames A3g, A7g): *Confirm it's you* and
 * the Google button, then the green confirmation row in its place. `onProof` hands the form what to
 * send; a confirmation the server no longer takes comes back here as `failed`.
 */
export function ConfirmWithGoogle({
  proof,
  onProof,
  failed,
  onError,
}: {
  proof: { readonly email: string } | null;
  onProof: (proof: ItsYou, email: string) => void;
  /** The last confirmation was refused or lapsed: say so above the button. */
  failed: boolean;
  onError: (error: unknown) => void;
}) {
  const { t } = useTourist();
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);

  if (proof !== null) {
    return (
      <View
        testID="google-confirmed"
        className="flex-row items-center gap-3 rounded-lg bg-success p-3"
      >
        <Icon icon={CircleCheck} size="md" color="success-foreground" />
        <View className="flex-1">
          <Text className="text-body-strong text-success-foreground">
            {t('account.confirm.done')}
          </Text>
          <Text className="text-label text-success-foreground">{proof.email}</Text>
        </View>
      </View>
    );
  }

  const go = async () => {
    setBusy(true);
    setRefused(false);
    try {
      const answer = await confirmWithGoogle();
      if (answer.kind === 'confirmed') onProof(answer.proof, answer.email);
      else if (answer.kind === 'failed') setRefused(true);
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="gap-2">
      <Text className="text-label text-foreground">{t('account.confirm.title')}</Text>
      {(failed || refused) && <ErrorLine text={t('account.confirm.failed')} />}
      <GoogleButton
        testID="google-confirm"
        label={t('account.google.continue')}
        busyLabel={t('account.google.busy')}
        loading={busy}
        onPress={() => void go()}
      />
    </View>
  );
}

/**
 * *Add a password* (frames A1g, K6, U3; K16): the reset link to the account's own address, at
 * once — no address to ask for — then the toast. The link opens round 31's L2.
 */
export async function addPassword(t: TouristT): Promise<void> {
  const email = useAccountStore.getState().user?.email;
  if (email === undefined) return;
  try {
    await forgotPassword(email);
    showToast(t('account.addPassword.sent', { email }));
  } catch (error) {
    showToast(errorMessage(error));
  }
}
