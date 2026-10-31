import { formatPublicCode } from '@wayfare/contracts';
import { useLocalSearchParams } from 'expo-router';
import { Headphones, QrCode } from 'lucide-react-native';
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { showMap } from '../src/codes/opener';
import { setPending } from '../src/codes/store';
import { checkTypedCode } from '../src/codes/typed';
import type { TypedCheck } from '../src/codes/typed';
import { useTourist } from '../src/i18n/use-tourist';
import { useTheme } from '../src/theme/appearance';
import { Icon } from '../src/theme/icon';
import { Button } from '../src/ui/button';
import { ScreenHeader } from '../src/ui/screen-header';
import { FormScroll } from '../src/ui/form-scroll';

/** A drawing of a printed Wayfare sticker with its code ringed: always light, it is paper. */
/** The drawn QR's size in the sticker illustration (handoff Q8). */
const STICKER_QR = 72;
/** The code entry's example: a sticker's code as printed (4 + 4), the same in every language. */
const CODE_EXAMPLE = 'K7M2 9QXA';

function Sticker() {
  const { t } = useTourist();
  const theme = useTheme();
  return (
    <View
      accessible={false}
      className="items-center justify-center gap-1 rounded-lg bg-card p-3 elevation-1"
    >
      <View className="flex-row items-center gap-1">
        <Icon icon={Headphones} size="xs" color="primary" />
        <Text className="text-caption text-foreground">{t('player.appName')}</Text>
      </View>
      {/* An illustration, not a UI icon: off the icon scale, as the design draws it. */}
      <QrCode size={STICKER_QR} color={theme.colors.foreground} strokeWidth={2.5} />
      <View className="rounded-md border border-primary px-2">
        <Text className="text-caption text-foreground">K7M2 9QXA</Text>
      </View>
    </View>
  );
}

/** Q8 · *Type the code*: the 8 characters under the QR, with the two errors the design names. */
export default function ScanCodeScreen() {
  const { t } = useTourist();
  const theme = useTheme();
  const params = useLocalSearchParams<{ code?: string }>();
  const [value, setValue] = useState(
    params.code === undefined ? '' : formatPublicCode(params.code),
  );
  const [problem, setProblem] = useState<Exclude<TypedCheck, { ok: true }> | null>(null);

  const message =
    problem === null
      ? null
      : problem.error === 'short'
        ? t('code.type.short', { n: problem.count })
        : problem.error === 'letter-u'
          ? t('code.type.letterU')
          : t('code.type.symbol');

  const open = () => {
    const check = checkTypedCode(value);
    if (!check.ok) return setProblem(check);
    setPending({ code: check.code, source: 'typed', printed: false });
    showMap();
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScreenHeader title={t('code.type.title')} type="back" />
      <FormScroll contentContainerClassName="gap-4 px-4">
        <View className="flex-row items-center gap-4">
          <Sticker />
          <Text className="flex-1 text-body text-foreground">{t('code.type.where')}</Text>
        </View>
        <View className="gap-1">
          <Text nativeID="code-label" className="text-label text-foreground">
            {t('code.type.label')}
          </Text>
          <TextInput
            accessibilityLabelledBy="code-label"
            accessibilityLabel={t('code.type.label')}
            value={value}
            onChangeText={(next) => {
              setValue(next);
              setProblem(null);
            }}
            onSubmitEditing={open}
            autoFocus
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            keyboardType="visible-password"
            returnKeyType="go"
            maxLength={16}
            placeholder={CODE_EXAMPLE}
            placeholderTextColor={theme.colors['muted-foreground']}
            className={`min-h-12 rounded-lg border-2 bg-card px-4 text-body text-foreground ${
              problem === null ? 'border-primary' : 'border-destructive'
            }`}
          />
          <Text
            accessibilityLiveRegion="polite"
            className={`text-caption ${problem === null ? 'text-muted-foreground' : 'text-destructive'}`}
          >
            {message ?? t('code.type.helper')}
          </Text>
        </View>
        <Button label={t('code.type.open')} disabled={problem !== null} onPress={open} />
      </FormScroll>
    </SafeAreaView>
  );
}
