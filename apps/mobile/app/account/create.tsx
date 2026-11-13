import { useRouter } from 'expo-router';
import { CloudOff } from 'lucide-react-native';
import { useState } from 'react';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createAccount } from '../../src/account/actions';
import { ErrorBanner, FormBody, LinkButton } from '../../src/account/components';
import { GoogleSection } from '../../src/account/google-components';
import { emailInvalid, formErrorOf, passwordTooShort } from '../../src/account/form-errors';
import type { FormError } from '../../src/account/form-errors';
import { useSubmit } from '../../src/account/use-form';
import { errorMessage } from '../../src/i18n';
import { useTourist } from '../../src/i18n/use-tourist';
import { Button } from '../../src/ui/button';
import { CheckboxRow } from '../../src/ui/checkbox-row';
import { InlineNote } from '../../src/ui/inline-note';
import { ScreenHeader } from '../../src/ui/screen-header';
import { TextField } from '../../src/ui/text-field';
import { showToast } from '../../src/ui/toast';
import { FormScroll } from '../../src/ui/form-scroll';

/** Create an account (frames G1–G3, K5): signed in at once, the app fully usable unverified. */
export default function CreateAccountScreen() {
  const { t } = useTourist();
  const router = useRouter();
  const { submit, running, offline } = useSubmit();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const [termsError, setTermsError] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);

  const create = () =>
    submit(async () => {
      setFailure(null);
      const before = emailInvalid(email, t) ?? passwordTooShort(password, t);
      setError(before);
      setTermsError(!accepted);
      if (before !== null || !accepted) return;
      try {
        const { needsTerms } = await createAccount({ email, password, fullName });
        showToast(t('account.created'));
        router.back();
        if (needsTerms) router.push('/account/terms');
      } catch (caught) {
        const known = formErrorOf('create', caught, t);
        setError(known);
        if (known === null) setFailure(errorMessage(caught));
      }
    });

  const fieldError = (place: FormError['place']) => (error?.place === place ? error.title : null);
  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScreenHeader title={t('account.create')} type="back" />
      <FormScroll>
        <FormBody>
          {offline && <InlineNote icon={CloudOff} text={t('account.offline.signIn')} />}
          <Text className="text-body text-muted-foreground">{t('account.create.lead')}</Text>
          {error?.place === 'banner' && <ErrorBanner title={error.title} body={error.body} />}
          {failure !== null && <ErrorBanner title={failure} />}
          <GoogleSection
            offline={offline}
            onBusy={setGoogleBusy}
            onError={(caught) => {
              const known = formErrorOf('signIn', caught, t);
              setError(known);
              if (known === null) setFailure(errorMessage(caught));
            }}
          />
          <TextField
            testID="create-email"
            label={t('account.field.email')}
            placeholder={t('account.field.emailPlaceholder')}
            value={email}
            onChangeText={setEmail}
            autoComplete="email"
            keyboardType="email-address"
            error={fieldError('email')}
          />
          {error?.action === 'sign-in-with-email' && (
            <LinkButton
              label={t('account.error.signInWithEmail')}
              onPress={() => router.replace({ pathname: '/account/sign-in', params: { email } })}
            />
          )}
          <TextField
            testID="create-password"
            label={t('account.field.password')}
            value={password}
            onChangeText={setPassword}
            secure
            showLabel={t('account.password.show')}
            hideLabel={t('account.password.hide')}
            autoComplete="password-new"
            helper={t('account.field.passwordHint')}
            error={fieldError('password')}
          />
          <TextField
            testID="create-name"
            label={t('account.field.name')}
            placeholder={t('account.field.namePlaceholder')}
            value={fullName}
            onChangeText={setFullName}
            autoComplete="name"
            autoCapitalize="words"
          />
          <CheckboxRow
            testID="create-terms"
            label={t('account.terms')}
            checked={accepted}
            onChange={(next) => {
              setAccepted(next);
              if (next) setTermsError(false);
            }}
            error={termsError ? t('account.error.terms') : null}
          />
          <Button
            testID="create-submit"
            label={t('account.create.submit')}
            onPress={() => void create()}
            loading={running}
            disabled={offline || googleBusy}
          />
          <LinkButton
            label={t('account.create.haveAccount')}
            onPress={() => router.replace('/account/sign-in')}
          />
        </FormBody>
      </FormScroll>
    </SafeAreaView>
  );
}
