import { useLocalSearchParams, useRouter } from 'expo-router';
import { CloudOff } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { requestEmailChange } from '../../src/account/actions';
import { ErrorBanner, FormBody } from '../../src/account/components';
import { emailInvalid, formErrorOf } from '../../src/account/form-errors';
import type { FormError } from '../../src/account/form-errors';
import { useSubmit } from '../../src/account/use-form';
import { errorMessage } from '../../src/i18n';
import { useTourist } from '../../src/i18n/use-tourist';
import { Button } from '../../src/ui/button';
import { InlineNote } from '../../src/ui/inline-note';
import { ScreenHeader } from '../../src/ui/screen-header';
import { TextField } from '../../src/ui/text-field';

/** *Change email* (frame A3, K11): the address changes only when the link is opened (A3b). */
export default function ChangeEmailScreen() {
  const { t } = useTourist();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const { submit, running, offline } = useSubmit();
  const [email, setEmail] = useState(params.email ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<FormError | null>(null);

  const send = () =>
    submit(async () => {
      const invalid = emailInvalid(email, t);
      setError(invalid);
      if (invalid !== null) return;
      try {
        await requestEmailChange(email, password);
        router.back();
      } catch (caught) {
        setError(
          formErrorOf('email', caught, t) ?? { place: 'banner', title: errorMessage(caught) },
        );
      }
    });

  const at = (place: FormError['place']) => (error?.place === place ? error.title : null);
  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScreenHeader title={t('account.changeEmail')} type="back" />
      <ScrollView keyboardShouldPersistTaps="handled">
        <FormBody>
          {offline && <InlineNote icon={CloudOff} text={t('account.offline.changes')} />}
          <Text className="text-body text-muted-foreground">{t('account.email.lead')}</Text>
          {error?.place === 'banner' && <ErrorBanner title={error.title} body={error.body} />}
          <TextField
            testID="email-new"
            label={t('account.field.newEmail')}
            placeholder={t('account.field.emailPlaceholder')}
            value={email}
            onChangeText={setEmail}
            autoComplete="email"
            keyboardType="email-address"
            error={at('email')}
          />
          <TextField
            testID="email-current"
            label={t('account.field.currentPassword')}
            value={password}
            onChangeText={setPassword}
            secure
            showLabel={t('account.password.show')}
            hideLabel={t('account.password.hide')}
            autoComplete="password"
            error={at('current')}
          />
          <Button
            label={t('account.sendLink')}
            onPress={() => void send()}
            loading={running}
            disabled={offline || email.trim() === '' || password === ''}
          />
        </FormBody>
      </ScrollView>
    </SafeAreaView>
  );
}
