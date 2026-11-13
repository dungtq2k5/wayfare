import { colors } from '@wayfare/design-tokens/tokens';
import { vars } from 'nativewind';
import { CameraView, PermissionStatus, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import {
  CircleCheck,
  Flashlight,
  FlashlightOff,
  Image as ImageIcon,
  Keyboard,
  ScanQrCode,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { judgeScan } from '../src/codes/scanner-reader';
import { useCameraFlags } from '../src/codes/flags';
import { showMap } from '../src/codes/opener';
import { setPending, useCodeStore } from '../src/codes/store';
import { useTourist } from '../src/i18n/use-tourist';
import { PermissionExplainer } from '../src/ui/permission-explainer';
import { TALL_CONTROL } from '../src/ui/layout';
import type { ExplainerContent } from '../src/ui/permission-explainer';

/** The scanner's chrome is drawn in the Dark mode whatever the appearance (handoff Q4). */
const DARK = colors.dark;
/** The Dark mode's tokens as the theme's variables, so the classes below resolve to them. */
const DARK_VARS = vars(
  Object.fromEntries(
    Object.entries(DARK).map(([name, hex]) => [
      `--${name}`,
      [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)).join(' '),
    ]),
  ),
);
const GUIDE = 260;
/** The hint pill's width, wrapping its text at large sizes (handoff: Scanner hint). */
const HINT_WIDTH = 340;
const RECOGNISED_MS = 400;
const NOT_WAYFARE_MS = 3_000;
const TOO_DARK_AFTER_MS = 6_000;

type Hint = 'point' | 'too-dark' | 'not-wayfare' | 'found';

/** Whether the camera may run: the screen in front and the app active. Nothing scans in the background. */
function useCameraActive(): boolean {
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) =>
      setActive(next === 'active'),
    );
    return () => subscription.remove();
  }, []);
  return focused && active;
}

function Corner({ edge, color }: { edge: 'tl' | 'tr' | 'bl' | 'br'; color: string }) {
  const top = edge === 'tl' || edge === 'tr';
  const left = edge === 'tl' || edge === 'bl';
  return (
    <View
      style={{
        position: 'absolute',
        width: 40,
        height: 40,
        borderColor: color,
        borderTopWidth: top ? 4 : 0,
        borderBottomWidth: top ? 0 : 4,
        borderLeftWidth: left ? 4 : 0,
        borderRightWidth: left ? 0 : 4,
        ...(top ? { top: 0 } : { bottom: 0 }),
        ...(left ? { left: 0 } : { right: 0 }),
      }}
    />
  );
}

/** The live camera with its bars, guide and hint (Q4–Q7). */
function Scanner() {
  const { t } = useTourist();
  const active = useCameraActive();
  const [torch, setTorch] = useState(false);
  const [hint, setHint] = useState<Hint>('point');
  const done = useRef(false);
  const lastRejected = useRef<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // No frame brightness from the camera library: the torch hint comes after 6 s without a read.
  useEffect(() => {
    if (!active || torch || hint !== 'point') return;
    const timer = setTimeout(() => setHint('too-dark'), TOO_DARK_AFTER_MS);
    return () => clearTimeout(timer);
  }, [active, torch, hint]);
  useEffect(() => () => clearTimeout(hintTimer.current), []);

  const onRead = useCallback(({ data }: { data: string }) => {
    if (done.current) return;
    const outcome = judgeScan(data, lastRejected.current);
    if (outcome.kind === 'not-wayfare') {
      if (outcome.repeat) return;
      lastRejected.current = data;
      setHint('not-wayfare');
      clearTimeout(hintTimer.current);
      hintTimer.current = setTimeout(() => setHint('point'), NOT_WAYFARE_MS);
      return;
    }
    // The first Wayfare code ends the reading: the same code, or a second one, is never read twice.
    done.current = true;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setHint('found');
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => {
      const { parsed } = outcome;
      if (parsed.kind === 'code') {
        setPending({ code: parsed.code, source: 'scan', printed: parsed.printed });
      } else {
        useCodeStore.setState({ result: { kind: 'bad-link' } });
      }
      showMap();
    }, RECOGNISED_MS);
  }, []);

  const hints: Record<Hint, { icon: LucideIcon; text: string }> = {
    point: { icon: ScanQrCode, text: t('code.scanner.point') },
    'too-dark': { icon: Flashlight, text: t('code.scanner.tooDark') },
    'not-wayfare': { icon: TriangleAlert, text: t('code.scanner.notWayfare') },
    found: { icon: CircleCheck, text: t('code.scanner.found') },
  };
  const shown = hints[hint];
  const corner = hint === 'found' ? DARK.primary : DARK.foreground;

  return (
    <View style={DARK_VARS} className="flex-1 bg-background">
      {active && (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={hint === 'found' ? undefined : onRead}
        />
      )}
      <SafeAreaView className="flex-1" edges={['top', 'bottom']}>
        <View
          style={{ minHeight: TALL_CONTROL }}
          className="flex-row items-center gap-2 bg-background px-2"
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('code.scanner.close')}
            onPress={() => router.back()}
            className="h-12 w-12 items-center justify-center"
          >
            <X size={24} color={DARK.foreground} />
          </Pressable>
          <Text accessibilityRole="header" className="flex-1 text-title text-foreground">
            {t('code.scan')}
          </Text>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: torch }}
            accessibilityLabel={torch ? t('code.scanner.torchOn') : t('code.scanner.torchOff')}
            onPress={() => {
              setTorch((on) => !on);
              setHint((now) => (now === 'too-dark' ? 'point' : now));
            }}
            className={`h-12 w-12 items-center justify-center rounded-full ${torch ? 'bg-foreground' : 'bg-muted'}`}
          >
            {torch ? (
              <Flashlight size={24} color={DARK.background} />
            ) : (
              <FlashlightOff size={24} color={DARK.foreground} />
            )}
          </Pressable>
        </View>

        <View className="flex-1 items-center justify-center gap-6 px-4">
          <View style={{ width: GUIDE, height: GUIDE }} accessible={false}>
            {(['tl', 'tr', 'bl', 'br'] as const).map((edge) => (
              <Corner key={edge} edge={edge} color={corner} />
            ))}
            {hint === 'found' && (
              <View className="flex-1 items-center justify-center">
                <CircleCheck size={72} color={DARK.primary} />
              </View>
            )}
          </View>
          <View
            accessibilityLiveRegion="polite"
            style={{ maxWidth: HINT_WIDTH }}
            className="w-full flex-row items-center gap-2 rounded-full bg-card px-4 py-3"
          >
            <shown.icon size={20} color={DARK.foreground} />
            <Text className="flex-1 text-label text-foreground">{shown.text}</Text>
          </View>
        </View>

        <View className="bg-background p-4">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('code.typeInstead')}
            onPress={() => router.replace('/scan-code')}
            className="min-h-12 flex-row items-center justify-center gap-2 rounded-lg bg-muted px-4"
          >
            <Keyboard size={20} color={DARK.foreground} />
            <Text className="text-label text-foreground">{t('code.typeInstead')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

/**
 * *Scan a code*: the scanner when the camera is allowed; otherwise the explainer the first time, then
 * Android's dialog; a refusal offers to try again or to open Settings, and every step offers to type
 * the code instead. Back from Settings with the camera allowed, the scanner opens.
 */
export default function ScanScreen() {
  const { t } = useTourist();
  const [permission, request, refresh] = useCameraPermissions();
  const explained = useCameraFlags((flags) => flags.explained);
  const asked = useRef(false);

  // The permission is read again whenever the app comes back to the front (from Settings, say).
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  // Explained before but never answered (the app closed on the dialog): ask straight away.
  useEffect(() => {
    if (permission?.status === PermissionStatus.UNDETERMINED && explained && !asked.current) {
      asked.current = true;
      void request();
    }
  }, [permission, explained, request]);

  if (permission === null) return <View className="flex-1 bg-background" />;
  if (permission.granted) return <Scanner />;

  const typeInstead = () => router.replace('/scan-code');
  const bullets = [
    { icon: ImageIcon, text: t('code.permission.noPhotos') },
    { icon: ShieldCheck, text: t('code.permission.staysOnPhone') },
    { icon: ScanQrCode, text: t('code.permission.onlyWhileOpen') },
  ];
  let content: ExplainerContent;
  let onPrimary: () => void;
  if (!explained) {
    content = {
      title: t('code.permission.title'),
      body: t('code.permission.body'),
      bullets,
      primary: t('walk.explainer.continue'),
      secondary: t('code.typeInstead'),
      footnote: t('code.permission.footnote'),
    };
    onPrimary = () => {
      useCameraFlags.setState({ explained: true });
      asked.current = true;
      void request();
    };
  } else if (permission.canAskAgain) {
    content = {
      title: t('code.denied.title'),
      body: t('code.denied.body'),
      bullets: [bullets[0]!],
      primary: t('walk.denied.tryAgain'),
      secondary: t('code.typeInstead'),
    };
    onPrimary = () => void request();
  } else {
    content = {
      title: t('code.denied.title'),
      body: t('code.denied.forever'),
      bullets: [bullets[0]!],
      primary: t('walk.denied.openSettings'),
      secondary: t('code.typeInstead'),
    };
    onPrimary = () => void Linking.openSettings();
  }
  return <PermissionExplainer content={content} onPrimary={onPrimary} onSecondary={typeInstead} />;
}
