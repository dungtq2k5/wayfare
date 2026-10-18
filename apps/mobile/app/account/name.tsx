import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
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
 * keyboard, its content scrolls when it is taller than the space left (the largest text).
 */
export default function NameScreen() {
  const { t } = useTourist();
  const router = useRouter();
  const { submit, running, offline } = useSubmit();
  const [name, setName] = useState(useAccountStore.getState().user?.fullName ?? '');
  const [failure, setFailure] = useState<string | null>(null);
  const empty = name.trim() === '';
  // The sheet sits above the keyboard: edge to edge, Android no longer shrinks the window for it
  // (nor does a KeyboardAvoidingView in this transparent modal), so the keyboard's own inset
  // shrinks the box the sheet fills — a margin, since the sheet is absolutely placed and a padding
  // would not move it — following the keyboard as it opens.
  const keyboard = useAnimatedKeyboard();
  const lifted = useAnimatedStyle(() => ({ flex: 1, marginBottom: keyboard.height.value }));

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
    <Animated.View style={lifted}>
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
    </Animated.View>
  );
}
