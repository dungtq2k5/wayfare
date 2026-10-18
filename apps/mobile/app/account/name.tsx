import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { changeName } from '../../src/account/actions';
import { ErrorBanner, FormBody, LinkButton } from '../../src/account/components';
import { useSubmit } from '../../src/account/use-form';
import { errorMessage } from '../../src/i18n';
import { useTourist } from '../../src/i18n/use-tourist';
import { useAccountStore } from '../../src/session/account-store';
import { Button } from '../../src/ui/button';
import { ScreenHeader } from '../../src/ui/screen-header';
import { TextField } from '../../src/ui/text-field';

/** The name (frames A2, A2b, K11): changed, never removed — *Save* rests while it is empty. */
export default function NameScreen() {
  const { t } = useTourist();
  const router = useRouter();
  const { submit, running, offline } = useSubmit();
  const [name, setName] = useState(useAccountStore.getState().user?.fullName ?? '');
  const [failure, setFailure] = useState<string | null>(null);
  const empty = name.trim() === '';

  const save = () =>
    submit(async () => {
      try {
        await changeName(name);
        router.back();
      } catch (caught) {
        setFailure(errorMessage(caught));
      }
    });

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScreenHeader title={t('account.name.title')} type="back" />
      <ScrollView keyboardShouldPersistTaps="handled">
        <FormBody>
          {failure !== null && <ErrorBanner title={failure} />}
          <TextField
            testID="name-field"
            label={t('account.name')}
            placeholder={t('account.field.namePlaceholder')}
            value={name}
            onChangeText={setName}
            autoComplete="name"
            autoCapitalize="words"
            helper={empty ? t('account.name.empty') : undefined}
          />
          <Button
            testID="name-save"
            label={t('account.save')}
            onPress={() => void save()}
            loading={running}
            disabled={empty || offline}
          />
          <LinkButton label={t('account.cancel')} onPress={() => router.back()} />
        </FormBody>
      </ScrollView>
    </SafeAreaView>
  );
}
