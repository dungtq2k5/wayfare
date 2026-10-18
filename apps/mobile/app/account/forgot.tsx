import { useRouter } from 'expo-router';
import { CloudOff, Mail } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { forgotPassword } from '../../src/account/actions';
import { ErrorBanner, FormBody, LinkResult } from '../../src/account/components';
import { emailInvalid, formErrorOf } from '../../src/account/form-errors';
import { useSubmit } from '../../src/account/use-form';
import { errorMessage } from '../../src/i18n';
import { useTourist } from '../../src/i18n/use-tourist';
import { Button } from '../../src/ui/button';
import { InlineNote } from '../../src/ui/inline-note';
import { ScreenHeader } from '../../src/ui/screen-header';
import { TextField } from '../../src/ui/text-field';

/** *Forgot password?* (frames G8, G8b): the same answer whether or not the account exists. */
export default function ForgotPasswordScreen() {
  const { t } = useTourist();
  const router = useRouter();
  const { submit, running, offline } = useSubmit();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState<{ title: string; body?: string } | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);

  const send = () =>
    submit(async () => {
      const wrong = emailInvalid(email, t);
      setInvalid(wrong?.title ?? null);
      if (wrong !== null) return;
      try {
        await forgotPassword(email);
        setSent(true);
      } catch (caught) {
        setFailure(formErrorOf('forgot', caught, t) ?? { title: errorMessage(caught) });
      }
    });

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScreenHeader title={t('account.forgot.title')} type="back" />
      <ScrollView keyboardShouldPersistTaps="handled">
        {sent ? (
          <LinkResult
            icon={Mail}
            title={t('account.forgot.sent.title')}
            body={t('account.forgot.sent.body', { email: email.trim() })}
            primary={{ label: t('account.backToSignIn'), onPress: () => router.back() }}
          />
        ) : (
          <FormBody>
            {offline && <InlineNote icon={CloudOff} text={t('account.offline.signIn')} />}
            <Text className="text-body text-muted-foreground">{t('account.forgot.lead')}</Text>
            {failure !== null && <ErrorBanner title={failure.title} body={failure.body} />}
            <TextField
              testID="forgot-email"
              label={t('account.field.email')}
              placeholder={t('account.field.emailPlaceholder')}
              value={email}
              onChangeText={setEmail}
              autoComplete="email"
              keyboardType="email-address"
              error={invalid}
            />
            <Button
              testID="forgot-submit"
              label={t('account.sendLink')}
              onPress={() => void send()}
              loading={running}
              disabled={offline || email.trim() === ''}
            />
          </FormBody>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
