// @vitest-environment happy-dom
import { colors } from '@wayfare/design-tokens/tokens';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryKv } from '../testing/shell-fakes';
import { renderHook, settle } from '@wayfare/ui/testing';

const scheme = vi.hoisted(() => ({ chosen: 'system', system: 'light', shown: 'light' }));
vi.mock('nativewind', () => ({
  colorScheme: {
    set: (value: string) => (scheme.chosen = value),
    get: () => scheme.system,
  },
  useColorScheme: () => ({ colorScheme: scheme.shown }),
}));
const systemUi = vi.hoisted(() => ({ setBackgroundColorAsync: vi.fn(() => Promise.resolve()) }));
vi.mock('expo-system-ui', () => systemUi);
vi.mock('expo-sqlite/kv-store', () => ({ default: memoryKv() }));

const { APPEARANCES, applyAppearance, useAppearance, useTheme } = await import('./appearance');
const { useAppStore } = await import('../state/app-store');

describe('the app’s appearance', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers the system’s, light and dark', () => {
    expect(APPEARANCES).toEqual(['system', 'light', 'dark']);
  });

  it('paints the window behind the first frame in the chosen scheme’s background', () => {
    applyAppearance('dark');
    expect(scheme.chosen).toBe('dark');
    expect(systemUi.setBackgroundColorAsync).toHaveBeenLastCalledWith(colors.dark.background);
    applyAppearance('light');
    expect(systemUi.setBackgroundColorAsync).toHaveBeenLastCalledWith(colors.light.background);
  });

  it('follows the phone’s own scheme when the choice is the system’s', () => {
    scheme.system = 'dark';
    applyAppearance('system');
    expect(systemUi.setBackgroundColorAsync).toHaveBeenLastCalledWith(colors.dark.background);
    scheme.system = 'light';
    applyAppearance('system');
    expect(systemUi.setBackgroundColorAsync).toHaveBeenLastCalledWith(colors.light.background);
  });

  it('gives a component the scheme on screen and its tokens', async () => {
    scheme.shown = 'dark';
    expect((await renderHook(() => useTheme())).current()).toEqual({
      mode: 'dark',
      colors: colors.dark,
    });
    scheme.shown = 'light';
    expect((await renderHook(() => useTheme())).current().mode).toBe('light');
  });

  it('reads the stored choice', async () => {
    const rendered = await renderHook(() => useAppearance());
    expect(rendered.current()).toBe('system');
    act(() => useAppStore.getState().setAppearance('dark'));
    await settle();
    expect(rendered.current()).toBe('dark');
  });
});
