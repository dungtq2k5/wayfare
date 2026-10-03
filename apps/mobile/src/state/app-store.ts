import { LEGAL_DOCUMENT_VERSIONS, LegalDocument } from '@wayfare/contracts';
import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** What the app remembers between launches, and what the gateway has told it this run. */
export interface AppState {
  /** The chosen language; null until the first-run picker. */
  language: string | null;
  /** True once this install is registered (the privacy notice accepted). */
  onboarded: boolean;
  /** Set once the persisted part has been read; nothing routes before it. */
  hydrated: boolean;
  /** The oldest version the gateway accepts, after a `426`. */
  updateRequired: string | null;
  /** The privacy policy version to accept, and whether the notice must be shown again. */
  policyVersion: string;
  policyChanged: boolean;
  setLanguage: (language: string | null) => void;
  setOnboarded: (onboarded: boolean) => void;
  requireUpdate: (minimumVersion: string) => void;
  requirePolicy: (currentVersion: string) => void;
  policyAccepted: () => void;
}

/** One Zustand store for client state (ADR 0029); server state lives in TanStack Query. */
export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      language: null,
      onboarded: false,
      hydrated: false,
      updateRequired: null,
      policyVersion: LEGAL_DOCUMENT_VERSIONS[LegalDocument.PRIVACY_POLICY],
      policyChanged: false,
      setLanguage: (language) => set({ language }),
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
      partialize: ({ language, onboarded }) => ({ language, onboarded }),
    },
  ),
);

// Nothing routes before the persisted part has been read (the key-value store answers asynchronously).
const markHydrated = (): void => {
  useAppStore.setState({ hydrated: true });
};
if (useAppStore.persist.hasHydrated()) markHydrated();
else useAppStore.persist.onFinishHydration(markHydrated);
