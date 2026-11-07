import { analyticsTransport } from '@wayfare/api-client';
import {
  AnalyticsEventType,
  LEGAL_DOCUMENT_VERSIONS,
  LegalDocument,
  newId,
} from '@wayfare/contracts';
import { AnalyticsClient } from '@wayfare/core';
import type { AnalyticsState, RecordInput } from '@wayfare/core';
import Storage from 'expo-sqlite/kv-store';
import { AppState } from 'react-native';
import { databaseReady } from '../data/boot';
import { useLocationStore } from '../location/location-store';
import { useNetworkStore } from '../network/network-store';
import { useAppStore } from '../state/app-store';
import { useWalkStore } from '../walk/store';
import { sqliteQueue } from './queue';

/** Its own row of the key-value store, never beside the device credentials (ADR 0042). */
const STATE_KEY = 'wayfare.analytics';

/** The sender's pace while the app is in front. */
const SEND_EVERY_MS = 5 * 60 * 1000;

/** The newest position the app already has — the walk's fix or the Map's — and when. */
function lastPosition(): { lat: number; lng: number; at: number } | null {
  const fix = useWalkStore.getState().fix;
  const map = useLocationStore.getState().position;
  const walk = fix === null ? null : { lat: fix.lat, lng: fix.lng, at: fix.t };
  const shown = map?.at === undefined ? null : { lat: map.lat, lng: map.lng, at: map.at };
  if (walk === null) return shown;
  if (shown === null) return walk;
  return walk.at >= shown.at ? walk : shown;
}

let opened: Promise<AnalyticsClient> | null = null;

/**
 * The install's analytics (the shared client, ADR 0042): opened once, over the key-value store and
 * the app's SQLite, following the app to the front, the network back and the language.
 */
export function analytics(): Promise<AnalyticsClient> {
  opened ??= AnalyticsClient.open({
    load: async () => {
      const stored = await Storage.getItem(STATE_KEY);
      return stored === null ? null : (JSON.parse(stored) as AnalyticsState);
    },
    save: (state) => Storage.setItem(STATE_KEY, JSON.stringify(state)),
    queue: sqliteQueue(() => databaseReady),
    transport: analyticsTransport,
    newId,
    now: Date.now,
    position: lastPosition,
    language: () => useAppStore.getState().language ?? 'en',
    buildPolicyVersion: LEGAL_DOCUMENT_VERSIONS[LegalDocument.PRIVACY_POLICY],
    onPolicyOutdated: (version) => useAppStore.getState().requirePolicy(version),
  }).then((client) => {
    follow(client);
    return client;
  });
  return opened;
}

/** Records one event — nothing unless the tourist allowed it. Never throws, never waits on the screen. */
export function track(input: RecordInput): void {
  void analytics()
    .then((client) => client.record(input))
    .catch(() => undefined);
}

/**
 * The app to the front, the network back, a 5-minute pace while active: each a send. A newer
 * privacy policy the app hears is remembered.
 */
function follow(client: AnalyticsClient): void {
  void client.foreground().catch(() => undefined);
  let timer: ReturnType<typeof setInterval> | null = setInterval(
    () => void client.flush(),
    SEND_EVERY_MS,
  );
  AppState.addEventListener('change', (next) => {
    if (next === 'active') {
      void client.foreground().catch(() => undefined);
      timer ??= setInterval(() => void client.flush(), SEND_EVERY_MS);
    } else if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  });
  // Any `409 LEGAL_VERSION_OUTDATED` the app hears names a newer policy: known from now on.
  void client.policyHeard(useAppStore.getState().policyVersion);
  useAppStore.subscribe((state, previous) => {
    if (state.policyVersion !== previous.policyVersion)
      void client.policyHeard(state.policyVersion);
    // A switch completed — not the first run's choice, which had no language before it.
    if (
      state.language !== null &&
      previous.language !== null &&
      state.language !== previous.language
    )
      void client.record({ type: AnalyticsEventType.LANGUAGE_SELECTED, lang: state.language });
  });
  useNetworkStore.subscribe((state, previous) => {
    if (state.status !== 'offline' && previous.status === 'offline') void client.flush();
  });
}
