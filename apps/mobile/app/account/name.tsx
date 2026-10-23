import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { changeName } from '../../src/account/actions';
import { ErrorBanner, LinkButton } from '../../src/account/components';
import { useSubmit } from '../../src/account/use-form';
import { errorMessage } from '../../src/i18n';
import { useTourist } from '../../src/i18n/use-tourist';
import { useAccountStore } from '../../src/session/account-store';
import { BottomSheet } from '../../src/ui/bottom-sheet';
import { Button } from '../../src/ui/button';
import { TextField } from '../../src/ui/text-field';

/**
 * The name (frames A2, A2b, K11): a bottom sheet over the Account screen, changed, never removed —
 * *Save* rests while it is empty. Back, *Cancel* and a tap on the scrim close it. Above the
 * keyboard (the sheet's own lift), its content scrolls when it is taller than the space left.
 */
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
    <View className="flex-1">
      <BottomSheet onClose={() => router.back()} closeLabel={t('action.close')}>
        <Text accessibilityRole="header" className="text-heading text-foreground">
          {t('account.name.title')}
        </Text>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4">
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
        </ScrollView>
      </BottomSheet>
    </View>
  );
}
