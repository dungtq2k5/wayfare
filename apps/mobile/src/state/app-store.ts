import { isSupportedLanguage, LEGAL_DOCUMENT_VERSIONS, LegalDocument } from '@wayfare/contracts';
import type { Language } from '@wayfare/contracts';
import Storage from 'expo-sqlite/kv-store';
import type { Appearance } from '../theme/appearance';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** The narration speeds, in the order the pill cycles through them. */
export const PLAYBACK_SPEEDS = [0.75, 1, 1.25, 1.5] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

/** What the app remembers between launches, and what the gateway has told it this run. */
export interface AppState {
  /** The chosen language; null until the first-run picker. */
  language: Language | null;
  /** How fast narration plays, whatever its source; remembered across narrations and launches. */
  playbackSpeed: PlaybackSpeed;
  /** Light, dark or the system's; `system` until the user chooses. */
  appearance: Appearance;
  /** The area the map is showing; the first synced one until the tourist chooses. */
  currentAreaId: string | null;
  /** True once this install is registered (the privacy notice accepted). */
  onboarded: boolean;
  /** Set once the persisted part has been read; nothing routes before it. */
  hydrated: boolean;
  /** The oldest version the gateway accepts, after a `426`. */
  updateRequired: string | null;
  /** The privacy policy version to accept, and whether the notice must be shown again. */
  policyVersion: string;
  policyChanged: boolean;
  setLanguage: (language: Language | null) => void;
  setPlaybackSpeed: (speed: PlaybackSpeed) => void;
  setAppearance: (appearance: Appearance) => void;
  setCurrentArea: (areaId: string) => void;
  setOnboarded: (onboarded: boolean) => void;
  requireUpdate: (minimumVersion: string) => void;
  requirePolicy: (currentVersion: string) => void;
  policyAccepted: () => void;
}

/**
 * Reads the persisted part back. What storage holds is whatever an older build wrote: a language
 * Wayfare no longer serves, or none, sends the person back to the picker.
 */
export function mergePersisted(persisted: unknown, current: AppState): AppState {
  const saved = (persisted ?? {}) as Partial<AppState>;
  return {
    ...current,
    ...saved,
    language: isSupportedLanguage(saved.language) ? saved.language : null,
    playbackSpeed: PLAYBACK_SPEEDS.find((speed) => speed === saved.playbackSpeed) ?? 1,
  };
}

/** One Zustand store for client state (ADR 0029); server state lives in TanStack Query. */
export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      language: null,
      playbackSpeed: 1,
      appearance: 'system',
      currentAreaId: null,
      onboarded: false,
      hydrated: false,
      updateRequired: null,
      policyVersion: LEGAL_DOCUMENT_VERSIONS[LegalDocument.PRIVACY_POLICY],
      policyChanged: false,
      setLanguage: (language) => set({ language }),
      setPlaybackSpeed: (playbackSpeed) => set({ playbackSpeed }),
      setAppearance: (appearance) => set({ appearance }),
      setCurrentArea: (currentAreaId) => set({ currentAreaId }),
      setOnboarded: (onboarded) => set({ onboarded }),
      requireUpdate: (minimumVersion) => set({ updateRequired: minimumVersion }),
      requirePolicy: (currentVersion) =>
        set({ policyVersion: currentVersion, policyChanged: true }),
      policyAccepted: () => set({ policyChanged: false }),
    }),
    {
      name: 'wayfare.app',
      // The key-value store of expo-sqlite, the database ADR 0027 chose: no second storage library.
      storage: createJSONStorage(() => Storage),
      merge: mergePersisted,
      partialize: ({ language, playbackSpeed, appearance, currentAreaId, onboarded }) => ({
        language,
        playbackSpeed,
        appearance,
        currentAreaId,
        onboarded,
      }),
    },
  ),
);

// Nothing routes before the persisted part has been read (the key-value store answers asynchronously).
const markHydrated = (): void => {
  useAppStore.setState({ hydrated: true });
};
if (useAppStore.persist.hasHydrated()) markHydrated();
else useAppStore.persist.onFinishHydration(markHydrated);
