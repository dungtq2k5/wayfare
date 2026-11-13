import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** Whether the camera's explainer has been shown on this install: it comes once. */
export const useCameraFlags = create<{ explained: boolean }>()(
  persist((): { explained: boolean } => ({ explained: false }), {
    name: 'wayfare.camera',
    storage: createJSONStorage(() => Storage),
  }),
);

/** *Forget this install*. */
export const resetCameraFlags = (): void => {
  useCameraFlags.setState({ explained: false });
};
