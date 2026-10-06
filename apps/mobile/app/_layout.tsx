import '../global.css';
import '../src/api';
import '../src/i18n';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { databaseReady } from '../src/data/boot';
import { persistOptions } from '../src/data/persister';
import { useDataBoot } from '../src/data/use-data-boot';
import { applyLanguage } from '../src/i18n';
import { applyAppearance, useTheme } from '../src/theme/appearance';
import { deviceSession } from '../src/session';
import { useAppStore } from '../src/state/app-store';
import { queryClient } from '../src/state/query-client';

/**
 * The providers, and the gate: *Update required* beats everything, then the first run (no
 * install yet, or a newer privacy notice to read), then the app.
 */
export default function RootLayout() {
  const hydrated = useAppStore((state) => state.hydrated);
  const onboarded = useAppStore((state) => state.onboarded);
  const language = useAppStore((state) => state.language);
  const policyChanged = useAppStore((state) => state.policyChanged);
  const updateRequired = useAppStore((state) => state.updateRequired);
  const appearance = useAppStore((state) => state.appearance);
  const theme = useTheme();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    applyAppearance(appearance);
  }, [appearance]);

  useEffect(() => {
    if (language !== null) void applyLanguage(language);
  }, [language]);

  // The stored pair can disappear on its own (backup restore, cleared keystore): then start over.
  useEffect(() => {
    if (!hydrated) return;
    void (async () => {
      if (useAppStore.getState().onboarded && !(await deviceSession.isRegistered())) {
        useAppStore.getState().setOnboarded(false);
      }
      await databaseReady; // migrated before any screen reads it
      setChecked(true);
    })();
  }, [hydrated]);

  const blocked = updateRequired !== null;
  const firstRun = !blocked && (!onboarded || policyChanged);
  // Sync needs a device token, so it waits for registration.
  useDataBoot(checked && onboarded && !blocked);

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
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={blocked}>
            <Stack.Screen name="update-required" />
          </Stack.Protected>
          <Stack.Protected guard={firstRun}>
            <Stack.Screen name="(first-run)" />
          </Stack.Protected>
          <Stack.Protected guard={!blocked && !firstRun}>
            <Stack.Screen name="index" />
            <Stack.Screen name="settings" />
          </Stack.Protected>
        </Stack>
      </ThemeProvider>
    </PersistQueryClientProvider>
  );
}
