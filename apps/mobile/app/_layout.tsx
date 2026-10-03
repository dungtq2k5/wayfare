import '../global.css';
import '../src/api';
import '../src/i18n';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { applyLanguage } from '../src/i18n';
import { deviceSession } from '../src/session';
import { useAppStore } from '../src/state/app-store';
import { queryClient } from '../src/state/query-client';

/**
 * The providers, and the gate: *Update required* beats everything, then the first run (no
 * install yet, or a newer privacy notice to read), then the app.
 */
export default function RootLayout(): React.JSX.Element | null {
  const hydrated = useAppStore((state) => state.hydrated);
  const onboarded = useAppStore((state) => state.onboarded);
  const language = useAppStore((state) => state.language);
  const policyChanged = useAppStore((state) => state.policyChanged);
  const updateRequired = useAppStore((state) => state.updateRequired);
  const [checked, setChecked] = useState(false);

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
      setChecked(true);
    })();
  }, [hydrated]);

  if (!hydrated || !checked) return null;

  const blocked = updateRequired !== null;
  const firstRun = !blocked && (!onboarded || policyChanged);
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
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
    </QueryClientProvider>
  );
}
