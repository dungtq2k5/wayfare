import { useLocalSearchParams, useRouter } from 'expo-router';
import { CloudOff } from 'lucide-react-native';
import { useState } from 'react';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '@wayfare/api-client';
import { ErrorBanner, FormBody, LinkButton } from '../../src/account/components';
import { formErrorOf } from '../../src/account/form-errors';
import type { FormError } from '../../src/account/form-errors';
import { linkWithPassword } from '../../src/account/google';
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
 * *Link Google* (frame K9, ADR 0064): the address Google picked already has a Wayfare account and
 * Google does not own its mailbox, so its password is asked once — through sign-in's own limits —
 * and then the link is made. Back leaves without linking; no password is ever removed here.
 */
export default function GoogleLinkScreen() {
  const { t } = useTourist();
  const router = useRouter();
  const { email = '', ticket = '' } = useLocalSearchParams<{ email?: string; ticket?: string }>();
  const { submit, running, offline } = useSubmit();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<FormError | null>(null);

  const go = () =>
    submit(async () => {
      try {
        const { favourites, needsTerms } = await linkWithPassword(email, password, ticket);
        const count = signedInCount(favourites);
        showToast(count === null ? t('account.signedIn.plain') : t('account.signedIn', { count }));
        router.back();
        if (needsTerms) router.push('/account/terms');
      } catch (caught) {
        // The ticket lapsed after the password was right: signed in, not linked — continue with
        // Google again to link.
        if (caught instanceof ApiError && caught.code === 'CONFIRMATION_EXPIRED') {
          showToast(t('account.googleLink.expired'));
          router.back();
          return;
        }
        setError(
          formErrorOf('signIn', caught, t) ?? { place: 'banner', title: errorMessage(caught) },
        );
      }
    });

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScreenHeader title={t('account.googleLink.title')} type="back" />
      <FormScroll>
        <FormBody>
          {offline && <InlineNote icon={CloudOff} text={t('account.offline.signIn')} />}
          <Text className="text-body text-muted-foreground">{t('account.googleLink.lead')}</Text>
          {error !== null && (
            <ErrorBanner
              title={error.title}
              body={error.body}
              action={
                error.action === 'forgot'
                  ? {
                      label: t('account.forgot'),
                      onPress: () =>
                        router.push({ pathname: '/account/forgot', params: { email } }),
                    }
                  : undefined
              }
            />
          )}
          <TextField
            testID="google-link-email"
            label={t('account.field.email')}
            placeholder={t('account.field.emailPlaceholder')}
            value={email}
            onChangeText={() => undefined}
            editable={false}
          />
          <TextField
            testID="google-link-password"
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
            testID="google-link-submit"
            label={t('account.googleLink.submit')}
            onPress={() => void go()}
            loading={running}
            disabled={offline || password === ''}
          />
          <LinkButton
            label={t('account.forgot')}
            onPress={() => router.push({ pathname: '/account/forgot', params: { email } })}
          />
        </FormBody>
      </FormScroll>
    </SafeAreaView>
  );
}
