import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '@wayfare/api-client';
import { ErrorBanner, FormBody, LinkButton } from '../../src/account/components';
import { formErrorOf } from '../../src/account/form-errors';
import type { FormError } from '../../src/account/form-errors';
import { unlinkGoogle } from '../../src/account/google';
import { addPassword } from '../../src/account/google-components';
import { useSubmit } from '../../src/account/use-form';
import { errorMessage } from '../../src/i18n';
import { useTourist } from '../../src/i18n/use-tourist';
import { Button } from '../../src/ui/button';
import { ScreenHeader } from '../../src/ui/screen-header';
import { TextField } from '../../src/ui/text-field';
import { showToast } from '../../src/ui/toast';

/**
 * *Remove Google sign-in* (frame U2, ADR 0063): what changes, then the current password. The action
 * is primary, not red — continuing with Google again links it back. An account with no password
 * gets *Add a password first* (frame U3) instead.
 */
export default function UnlinkGoogleScreen() {
  const { t } = useTourist();
  const router = useRouter();
  const { submit, running, offline } = useSubmit();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<FormError | null>(null);

  const remove = () =>
    submit(async () => {
      try {
        await unlinkGoogle(password);
        showToast(t('account.unlink.done'));
        router.back();
      } catch (caught) {
        if (caught instanceof ApiError && caught.code === 'PASSWORD_REQUIRED') {
          Alert.alert(
            t('account.unlink.needPassword.title'),
            t('account.unlink.needPassword.body'),
            [
              { text: t('account.cancel'), style: 'cancel' },
              { text: t('account.addPassword'), onPress: () => void addPassword(t) },
            ],
          );
          return;
        }
        setError(
          formErrorOf('password', caught, t) ?? { place: 'banner', title: errorMessage(caught) },
        );
      }
    });

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScreenHeader title={t('account.unlink.row')} type="back" />
      <ScrollView keyboardShouldPersistTaps="handled">
        <FormBody>
          <Text className="text-body text-muted-foreground">{t('account.unlink.body')}</Text>
          {error?.place === 'banner' && <ErrorBanner title={error.title} body={error.body} />}
          <TextField
            testID="unlink-password"
            label={t('account.field.currentPassword')}
            value={password}
            onChangeText={setPassword}
            secure
            showLabel={t('account.password.show')}
            hideLabel={t('account.password.hide')}
            autoComplete="password"
            error={error?.place === 'current' ? error.title : null}
          />
          <Button
            testID="unlink-submit"
            label={t('account.unlink.row')}
            onPress={() => void remove()}
            loading={running}
            disabled={offline || password === ''}
          />
          <LinkButton label={t('account.cancel')} onPress={() => router.back()} />
        </FormBody>
      </ScrollView>
    </SafeAreaView>
  );
}
