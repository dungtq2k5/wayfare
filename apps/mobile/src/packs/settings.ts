import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** What the tourist chose about downloads, kept between launches. */
export interface PackSettings {
  /** *Update automatically on Wi-Fi* (K15), off until switched on. */
  autoUpdate: boolean;
  /** The areas the offer (frame O1) was already shown for: either answer retires it (K20). */
  offered: string[];
}

const none: PackSettings = { autoUpdate: false, offered: [] };

export const usePackSettings = create<PackSettings>()(
  persist(() => ({ ...none }), {
    name: 'wayfare.packs',
    storage: createJSONStorage(() => Storage),
  }),
);

/** *Forget this install*. */
export const resetPackSettings = (): void => {
  usePackSettings.setState({ ...none });
};
