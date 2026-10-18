import { useRouter } from 'expo-router';
import { CloudOff } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { changePassword } from '../../src/account/actions';
import { ErrorBanner, FormBody } from '../../src/account/components';
import { formErrorOf, passwordTooShort } from '../../src/account/form-errors';
import type { FormError } from '../../src/account/form-errors';
import { useSubmit } from '../../src/account/use-form';
import { errorMessage } from '../../src/i18n';
import { useTourist } from '../../src/i18n/use-tourist';
import { Button } from '../../src/ui/button';
import { InlineNote } from '../../src/ui/inline-note';
import { ScreenHeader } from '../../src/ui/screen-header';
import { TextField } from '../../src/ui/text-field';
import { showToast } from '../../src/ui/toast';

/** *Change password* (frames A4, A4b, K12): this phone stays signed in; the others are not. */
export default function ChangePasswordScreen() {
  const { t } = useTourist();
  const router = useRouter();
  const { submit, running, offline } = useSubmit();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<FormError | null>(null);

  const save = () =>
    submit(async () => {
      const short = passwordTooShort(next, t);
      setError(short);
      if (short !== null) return;
      try {
        await changePassword(current, next);
        showToast(t('account.password.changed'));
        router.back();
      } catch (caught) {
        setError(
          formErrorOf('password', caught, t) ?? { place: 'banner', title: errorMessage(caught) },
        );
      }
    });

  const at = (place: FormError['place']) => (error?.place === place ? error.title : null);
  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScreenHeader title={t('account.changePassword')} type="back" />
      <ScrollView keyboardShouldPersistTaps="handled">
        <FormBody>
          {offline && <InlineNote icon={CloudOff} text={t('account.offline.changes')} />}
          {error?.place === 'banner' && <ErrorBanner title={error.title} body={error.body} />}
          <TextField
            label={t('account.field.currentPassword')}
            value={current}
            onChangeText={setCurrent}
            secure
            showLabel={t('account.password.show')}
            hideLabel={t('account.password.hide')}
            autoComplete="password"
            error={at('current')}
          />
          <TextField
            label={t('account.field.newPassword')}
            value={next}
            onChangeText={setNext}
            secure
            showLabel={t('account.password.show')}
            hideLabel={t('account.password.hide')}
            autoComplete="password-new"
            helper={t('account.field.passwordHint')}
            error={at('password')}
          />
          <Button
            label={t('account.save')}
            onPress={() => void save()}
            loading={running}
            disabled={offline || current === '' || next === ''}
          />
        </FormBody>
      </ScrollView>
    </SafeAreaView>
  );
}
