import type { Question } from '@wayfare/core';
import { space } from '@wayfare/design-tokens/tokens';
import { ChartColumn, CircleCheck, CircleX } from 'lucide-react-native';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  Linking,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCodeStore } from '../codes/store';
import { PRIVACY_POLICY_URL } from '../env';
import { useTourist } from '../i18n/use-tourist';
import { usePlayerStore } from '../player/store';
import { useAppStore } from '../state/app-store';
import { Icon } from '../theme/icon';
import { Button } from '../ui/button';
import { LARGE_TEXT_SCALE } from '../ui/layout';
import { useAnalytics } from '../analytics/use-analytics';

/** How far the handle is dragged down before the sheet closes. */
const DRAG_CLOSE = 80;

/** A policy version (`YYYY-MM-DD`) as a date in the reader's language. */
function policyDate(version: string, locale: string): string {
  const date = new Date(`${version}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? version
    : new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(date);
}

/**
 * The question (AC1), and a new policy's (AC5): what is counted and what never is, then two equal
 * choices, neither pre-selected. Closing chooses nothing. Focus starts on the title; at large text
 * the choices stack and stay at the bottom, the content scrolling above them.
 */
export function ConsentSheet({
  variant,
  policyVersion,
  onAllow,
  onNoThanks,
  onClose,
}: {
  variant: Exclude<Question, null>;
  /** The version a new policy's question asks about. */
  policyVersion: string;
  onAllow: () => void;
  onNoThanks: () => void;
  onClose: () => void;
}) {
  const { t } = useTourist();
  const locale = useAppStore((state) => state.language ?? 'en');
  const insets = useSafeAreaInsets();
  const stacked = useWindowDimensions().fontScale >= LARGE_TEXT_SCALE;
  const title = useRef<Text>(null);
  // The handle drags the sheet away, which, like the scrim and Back, chooses nothing.
  const close = useRef(onClose);
  close.current = onClose;
  const drag = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 8,
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > DRAG_CLOSE) close.current();
      },
    }),
  ).current;
  useEffect(() => {
    const node = findNodeHandle(title.current);
    if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
  }, []);
  const changed = variant === 'changed';
  // The summary describes one version: shown only when it's this one (an older build's isn't).
  const summary =
    t('consent.changed.version') === policyVersion ? t('consent.changed.summary') : null;
  const date = policyDate(policyVersion, locale);
  const row = (icon: typeof CircleCheck, text: string) => (
    <View key={text} className="flex-row items-start gap-2">
      <View className="pt-0.5">
        <Icon icon={icon} size="xs" color={icon === CircleCheck ? 'primary' : 'muted-foreground'} />
      </View>
      <Text className="flex-1 text-sm text-card-foreground">{text}</Text>
    </View>
  );
  // Modal: on the screen's bottom edge, over the tab bar, nothing else reachable; Back closes it.
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View className="absolute inset-0" accessibilityViewIsModal>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('action.close')}
          onPress={onClose}
          className="absolute inset-0 bg-overlay/50"
        />
        <View
          accessibilityRole="none"
          style={{ paddingBottom: Math.max(insets.bottom, space[6]), maxHeight: '92%' }}
          className="absolute inset-x-0 bottom-0 gap-4 rounded-t-2xl bg-card px-6 pt-4"
        >
          <View {...drag.panHandlers} className="-my-2 items-center py-2">
            <View className="h-1 w-10 rounded-full bg-border" />
          </View>
          <ScrollView className="shrink" contentContainerClassName="gap-4">
            <View className="size-12 items-center justify-center rounded-2xl bg-success">
              <Icon icon={ChartColumn} size="md" color="success-foreground" />
            </View>
            <Text
              ref={title}
              accessibilityRole="header"
              className="text-title text-card-foreground"
            >
              {changed ? t('consent.changed.title') : t('consent.title')}
            </Text>
            <Text className="text-body text-card-foreground">
              {changed
                ? summary === null
                  ? t('consent.changed.leadPlain', { date })
                  : t('consent.changed.lead', { date, summary })
                : t('consent.lead')}
            </Text>
            <View className="gap-2">
              {row(CircleCheck, t('consent.counted.stories'))}
              {row(CircleCheck, t('consent.counted.language'))}
              {row(CircleCheck, t('consent.counted.square'))}
            </View>
            <View className="gap-2">
              {row(CircleX, t('consent.never.person'))}
              {row(CircleX, t('consent.never.linked'))}
            </View>
            {changed && (
              <Text className="text-label text-card-foreground">{t('consent.changed.until')}</Text>
            )}
          </ScrollView>
          <View className={stacked ? 'gap-3' : 'flex-row gap-3'}>
            <View className={stacked ? '' : 'flex-1'}>
              <Button
                testID="consent-no-thanks"
                variant="secondary"
                label={t('consent.noThanks')}
                onPress={onNoThanks}
              />
            </View>
            <View className={stacked ? '' : 'flex-1'}>
              <Button
                testID="consent-allow"
                variant="secondary"
                label={t('consent.allow')}
                onPress={onAllow}
              />
            </View>
          </View>
          <View className="flex-row flex-wrap items-center justify-between gap-2">
            <Text className="text-caption text-muted-foreground">{t('consent.footer')}</Text>
            <Pressable
              accessibilityRole="link"
              onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
              className="min-h-12 justify-center"
            >
              <Text className="text-caption text-primary underline">
                {t('consent.privacyPolicy')}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Shows the owed question on the Map at the right moment (K7, K8): the Map in front, no story
 * playing or being prepared, no other sheet open. Once shown it stays until a choice or a close; a
 * choice is acted on once, however many taps.
 */
export function ConsentSheetHost() {
  const live = useAnalytics();
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const idle = usePlayerStore((state) => state.current === null && state.sheet.placeId === null);
  const codeSheet = useCodeStore((state) => state.result !== null);
  const [shown, setShown] = useState<Exclude<Question, null> | null>(null);
  const acted = useRef(false);
  // The question just answered stays answered until the client's snapshot says so.
  const answered = useRef<Question>(null);
  const question = live?.snapshot.question ?? null;
  if (question === null) answered.current = null;
  useEffect(() => {
    if (question !== null && question === answered.current) return;
    if (shown === null && question !== null && focused && idle && !codeSheet) {
      acted.current = false;
      setShown(question);
    }
  }, [shown, question, focused, idle, codeSheet]);
  if (live === null || shown === null) return null;
  const act = (choice: () => Promise<void>) => {
    if (acted.current) return;
    acted.current = true;
    answered.current = shown;
    setShown(null);
    void choice();
  };
  return (
    <ConsentSheet
      variant={shown}
      policyVersion={live.snapshot.state.knownPolicyVersion}
      onAllow={() => act(() => live.client.allow())}
      onNoThanks={() => act(() => live.client.withdraw())}
      onClose={() => act(() => live.client.closeQuestion())}
    />
  );
}
