import { colors } from '@wayfare/design-tokens/tokens';
import { colorScheme, useColorScheme } from 'nativewind';
import * as SystemUI from 'expo-system-ui';
import { useAppStore } from '../state/app-store';

/** The user's choice: follow the system, or stay light or dark. */
export type Appearance = 'system' | 'light' | 'dark';

export const APPEARANCES: readonly Appearance[] = ['system', 'light', 'dark'];

/**
 * Makes `appearance` the app's: NativeWind swaps the colour variables, and the window behind the
 * first frame takes the background token, so a dark phone never flashes white.
 */
export function applyAppearance(appearance: Appearance): void {
  colorScheme.set(appearance);
  const resolved = appearance === 'system' ? colorScheme.get() : appearance;
  void SystemUI.setBackgroundColorAsync(colors[resolved === 'dark' ? 'dark' : 'light'].background);
}

/** The scheme on screen now, and its token values (for what a class cannot reach). */
export function useTheme() {
  const { colorScheme: scheme } = useColorScheme();
  const mode = scheme === 'dark' ? 'dark' : 'light';
  return { mode, colors: colors[mode] } as const;
}

/** The stored choice. */
export function useAppearance(): Appearance {
  return useAppStore((state) => state.appearance);
}
