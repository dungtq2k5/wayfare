import { formatPublicCode } from '@wayfare/contracts';
import { router } from 'expo-router';
import type { LucideIcon } from 'lucide-react-native';
import { CircleAlert, CircleX, Link2Off, LoaderCircle, WifiOff } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';
import { space } from '@wayfare/design-tokens/tokens';
import { useTourist } from '../i18n/use-tourist';
import { usePlayerStore } from '../player/store';
import { MINI_PLAYER_CLEARANCE, SHEET_ICON_DISC } from '../ui/layout';
import { checkNetwork } from '../network/network-store';
import { Icon } from '../theme/icon';
import { Button } from '../ui/button';
import { codeOpener } from './opener';
import { useCodeStore } from './store';
import type { CodeResult } from './store';

interface Shown {
  icon: LucideIcon;
  title: string;
  body: string;
  primary?: { label: string; onPress: () => void };
  secondary: { label: string; onPress: () => void };
}

const close = () => useCodeStore.setState({ result: null });

/** A code that did not open a Place, as a sheet over the Map with a next step (Q10–Q13, Q12b). */
export function CodeResultSheet() {
  const { t } = useTourist();
  const result = useCodeStore((state) => state.result);
  const playing = usePlayerStore((state) => state.current !== null);
  if (result === null) return null;

  const scan = () => {
    close();
    router.push('/scan');
  };
  const backToMap = { label: t('code.backToMap'), onPress: close };
  const shown = ((r: CodeResult): Shown => {
    switch (r.kind) {
      case 'looking-up':
        return {
          icon: LoaderCircle,
          title: t('code.lookingUp.title', { code: formatPublicCode(r.code) }),
          body: t('code.lookingUp.body'),
          secondary: { label: t('action.cancel'), onPress: () => codeOpener.cancel() },
        };
      case 'no-longer':
        return {
          icon: CircleX,
          title: t('code.noLonger.title'),
          body: t('code.noLonger.body'),
          primary: { label: t('code.scanAnother'), onPress: scan },
          secondary: backToMap,
        };
      case 'no-such-code':
        return {
          icon: CircleAlert,
          title: t('code.noSuch.title', { code: formatPublicCode(r.code) }),
          body: t('code.noSuch.body'),
          primary: {
            label: t('code.typeAgain'),
            onPress: () => {
              close();
              router.push({ pathname: '/scan-code', params: { code: r.code } });
            },
          },
          secondary: { label: t('code.scanInstead'), onPress: scan },
        };
      case 'bad-link':
        return {
          icon: Link2Off,
          title: t('code.badLink.title'),
          body: t('code.badLink.body'),
          primary: { label: t('code.scan'), onPress: scan },
          secondary: backToMap,
        };
      case 'offline':
        return {
          icon: WifiOff,
          title: t('code.offline.title'),
          body: t('code.offline.body'),
          primary: {
            label: t('action.retry'),
            // The network verdict is read at launch: ask again before trying, so a connection that
            // came back is noticed.
            onPress: () =>
              void checkNetwork().then(() => codeOpener.open(r.code, { printed: false })),
          },
          secondary: backToMap,
        };
    }
  })(result);

  return (
    <View
      accessibilityViewIsModal
      accessibilityLiveRegion="polite"
      // The mini player rides at the bottom of the map: the sheet's buttons sit above it.
      style={{ paddingBottom: playing ? MINI_PLAYER_CLEARANCE : space[6] }}
      className="absolute inset-x-0 bottom-0 gap-3 rounded-t-2xl bg-card px-6 pt-3 elevation-2"
    >
      <View className="h-1 w-10 self-center rounded-full bg-border" />
      <View
        style={{ width: SHEET_ICON_DISC, height: SHEET_ICON_DISC }}
        className="items-center justify-center self-center rounded-full bg-muted"
      >
        <Icon icon={shown.icon} size="lg" color="foreground" />
      </View>
      <Text accessibilityRole="header" className="text-center text-heading text-foreground">
        {shown.title}
      </Text>
      <Text className="text-center text-body text-muted-foreground">{shown.body}</Text>
      {shown.primary !== undefined && (
        <Button label={shown.primary.label} onPress={shown.primary.onPress} />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={shown.secondary.label}
        onPress={shown.secondary.onPress}
        className="min-h-12 items-center justify-center"
      >
        <Text className="text-label text-primary">{shown.secondary.label}</Text>
      </Pressable>
    </View>
  );
}
