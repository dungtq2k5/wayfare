import '../global.css';
import '../src/api';
import '../src/i18n';
import '../src/walk/task';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { vars } from 'nativewind';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { databaseReady } from '../src/data/boot';
import { hydrateWalk } from '../src/walk/controller';
import { loadHeard } from '../src/data/heard';
import { persistOptions } from '../src/data/persister';
import { useDataBoot } from '../src/shell/use-data-boot';
import { DownloadSheetHost } from '../src/packs/download-sheet';
import { FakeGooglePickerHost } from '../src/account/fake-google-picker';
import { usePackBoot } from '../src/packs/use-pack-boot';
import { useAccountBoot } from '../src/account/use-account-boot';
import { useLanguageSwitch } from '../src/language/switch-deps';
import { applyAppearance, useTheme } from '../src/theme/appearance';
import { scriptLeading } from '../src/theme/script-leading';
import { deviceSession } from '../src/session';
import { useAppStore } from '../src/state/app-store';
import { queryClient } from '../src/state/query-client';
import { ToastHost } from '../src/ui/toast';
import { WalkPromptHost } from '../src/walk/prompt-host';

/**
 * The providers, and the gate: *Update required* beats everything, then the first run (no
 * install yet, or a newer privacy notice to read), then the app.
 */
export default function RootLayout() {
  const hydrated = useAppStore((state) => state.hydrated);
  const onboarded = useAppStore((state) => state.onboarded);
  const policyChanged = useAppStore((state) => state.policyChanged);
  const updateRequired = useAppStore((state) => state.updateRequired);
  const appearance = useAppStore((state) => state.appearance);
  const language = useAppStore((state) => state.language);
  const leading = useMemo(() => {
    const heights = scriptLeading(language);
    return heights === null ? undefined : vars(heights);
  }, [language]);
  const theme = useTheme();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    applyAppearance(appearance);
  }, [appearance]);

  useLanguageSwitch();

  // The stored pair can disappear on its own (backup restore, cleared keystore): then start over.
  useEffect(() => {
    if (!hydrated) return;
    void (async () => {
      if (useAppStore.getState().onboarded && !(await deviceSession.isRegistered())) {
        useAppStore.getState().setOnboarded(false);
      }
      await databaseReady; // migrated before any screen reads it
      void hydrateWalk();
      void loadHeard();
      setChecked(true);
    })();
  }, [hydrated]);

  const blocked = updateRequired !== null;
  const firstRun = !blocked && (!onboarded || policyChanged);
  // Sync needs a device token, so it waits for registration.
  useDataBoot(checked && onboarded && !blocked);
  usePackBoot(checked && onboarded && !blocked);
  useAccountBoot(checked && onboarded && !blocked);

  if (!hydrated || !checked) return null;
  // Navigation reads the active mode's tokens: header, card and page colours follow the theme.
  const base = theme.mode === 'dark' ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: theme.colors.primary,
      background: theme.colors.background,
      card: theme.colors.background,
      text: theme.colors.foreground,
      border: theme.colors.border,
    },
  };
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <ThemeProvider value={navigationTheme}>
        <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
        {/* Taller lines for the scripts that need them, for every screen below. */}
        <View style={leading} className="flex-1">
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Protected guard={blocked}>
              <Stack.Screen name="update-required" />
            </Stack.Protected>
            <Stack.Protected guard={firstRun}>
              <Stack.Screen name="(first-run)" />
            </Stack.Protected>
            <Stack.Protected guard={!blocked && !firstRun}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="place/[id]" />
              <Stack.Screen name="player" options={{ animation: 'slide_from_bottom' }} />
              <Stack.Screen name="transcript" />
              <Stack.Screen name="walk-help" />
              <Stack.Screen name="scan" options={{ animation: 'slide_from_bottom' }} />
              <Stack.Screen name="scan-code" />
              <Stack.Screen name="settings/language" />
              <Stack.Screen name="settings/credits" />
              <Stack.Screen name="settings/diagnostics" />
              <Stack.Screen name="settings/downloads" />
              <Stack.Screen name="settings/pack" />
              <Stack.Screen name="account/index" />
              <Stack.Screen name="account/create" />
              <Stack.Screen name="account/sign-in" />
              <Stack.Screen name="account/forgot" />
              {/* A bottom sheet over the Account screen: the route draws its own scrim. */}
              <Stack.Screen
                name="account/name"
                options={{ presentation: 'transparentModal', animation: 'fade' }}
              />
              <Stack.Screen name="account/email" />
              <Stack.Screen name="account/password" />
              <Stack.Screen name="account/delete" />
              <Stack.Screen name="account/terms" options={{ gestureEnabled: false }} />
              <Stack.Screen name="account/link" />
              <Stack.Screen name="account/google-link" />
              <Stack.Screen name="account/unlink-google" />
            </Stack.Protected>
          </Stack>
          <DownloadSheetHost />
          <FakeGooglePickerHost />
          <ToastHost />
          <WalkPromptHost />
        </View>
      </ThemeProvider>
    </PersistQueryClientProvider>
  );
}
