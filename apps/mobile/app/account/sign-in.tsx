import { useLocalSearchParams, useRouter } from 'expo-router';
import { CircleCheck, CloudOff } from 'lucide-react-native';
import { useState } from 'react';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signIn } from '../../src/account/actions';
import { ErrorBanner, FormBody, LinkButton } from '../../src/account/components';
import { GoogleSection } from '../../src/account/google-components';
import { emailInvalid, formErrorOf } from '../../src/account/form-errors';
import type { FormError } from '../../src/account/form-errors';
import { signedInCount } from '../../src/account/rules';
import { useSubmit } from '../../src/account/use-form';
import { errorMessage } from '../../src/i18n';
import { useTourist } from '../../src/i18n/use-tourist';
import { Button } from '../../src/ui/button';
import { InlineNote } from '../../src/ui/inline-note';
import { ScreenHeader } from '../../src/ui/screen-header';
import { TextField } from '../../src/ui/text-field';
import { showToast } from '../../src/ui/toast';
import { FormScroll } from '../../src/ui/form-scroll';

/**
 * Sign in (frames G4–G6, K1, K6, K7): errors in one banner, the favourites' count in the toast.
 * After a reset with nobody signed in (frame L2c), it opens with a note and an empty email.
 */
export default function SignInScreen() {
  const { t } = useTourist();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; note?: string }>();
  const { submit, running, offline } = useSubmit();
  const [email, setEmail] = useState(params.email ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<FormError | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);

  const go = () =>
    submit(async () => {
      const invalid = emailInvalid(email, t);
      setError(invalid);
      if (invalid !== null) return;
      try {
        const { favourites, needsTerms } = await signIn(email, password);
        const count = signedInCount(favourites);
        showToast(count === null ? t('account.signedIn.plain') : t('account.signedIn', { count }));
        router.back();
        if (needsTerms) router.push('/account/terms');
      } catch (caught) {
        setError(
          formErrorOf('signIn', caught, t) ?? { place: 'banner', title: errorMessage(caught) },
        );
      }
    });

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScreenHeader title={t('account.signIn')} type="back" />
      <FormScroll>
        <FormBody>
          {offline && <InlineNote icon={CloudOff} text={t('account.offline.signIn')} />}
          {params.note === 'reset' ? (
            <InlineNote icon={CircleCheck} text={t('account.link.reset.signIn')} />
          ) : (
            <Text className="text-body text-muted-foreground">{t('account.signIn.lead')}</Text>
          )}
          {error !== null && error.place !== 'email' && (
            <ErrorBanner
              title={error.title}
              body={error.body}
              action={
                error.action === 'forgot'
                  ? { label: t('account.forgot'), onPress: () => router.push('/account/forgot') }
                  : undefined
              }
            />
          )}
          <GoogleSection
            offline={offline}
            onBusy={setGoogleBusy}
            onError={(caught) =>
              setError(
                formErrorOf('signIn', caught, t) ?? {
                  place: 'banner',
                  title: errorMessage(caught),
                },
              )
            }
          />
          <TextField
            testID="sign-in-email"
            label={t('account.field.email')}
            placeholder={t('account.field.emailPlaceholder')}
            value={email}
            onChangeText={setEmail}
            autoComplete="email"
            keyboardType="email-address"
            error={error?.place === 'email' ? error.title : null}
          />
          <TextField
            testID="sign-in-password"
            label={t('account.field.password')}
            value={password}
            onChangeText={setPassword}
            secure
            showLabel={t('account.password.show')}
            hideLabel={t('account.password.hide')}
            autoComplete="password"
            onSubmitEditing={() => void go()}
          />
          <Button
            testID="sign-in-submit"
            label={t('account.signIn')}
            onPress={() => void go()}
            loading={running}
            disabled={offline || googleBusy}
          />
          <LinkButton label={t('account.forgot')} onPress={() => router.push('/account/forgot')} />
          <LinkButton
            label={t('account.create')}
            onPress={() => router.replace('/account/create')}
          />
        </FormBody>
      </FormScroll>
    </SafeAreaView>
  );
}
