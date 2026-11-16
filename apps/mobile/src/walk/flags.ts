import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** What the walk has already told this install, so an explainer never comes back. */
export interface WalkFlags {
  backgroundExplained: boolean;
  notificationsExplained: boolean;
  foregroundOnlyNoticed: boolean;
}

const none: WalkFlags = {
  backgroundExplained: false,
  notificationsExplained: false,
  foregroundOnlyNoticed: false,
};

export const useWalkFlags = create<WalkFlags>()(
  persist(() => ({ ...none }), {
    name: 'wayfare.walk',
    storage: createJSONStorage(() => Storage),
  }),
);

export const markWalkFlag = (flag: keyof WalkFlags): void => {
  useWalkFlags.setState({ [flag]: true });
};

/** *Forget this install*. */
export const resetWalkFlags = (): void => {
  useWalkFlags.setState({ ...none });
};
