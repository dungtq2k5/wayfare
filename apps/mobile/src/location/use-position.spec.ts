// @vitest-environment happy-dom
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nativeFake } from '../testing/react-native';
import { renderHook, settle } from '@wayfare/ui/testing';
import { phone, resetPhone } from '../testing/walk-fakes';

vi.mock('expo-location', async () => (await import('../testing/walk-fakes')).expoLocation);
/** The screen's focus, which the test gives and takes away. */
const focus = vi.hoisted(() => ({ blur: null as null | (() => void) }));
vi.mock('expo-router', async () => {
  const { useEffect } = await import('react');
  return {
    useFocusEffect: (effect: () => (() => void) | undefined) =>
      useEffect(() => {
        const cleanup = effect();
        focus.blur = cleanup ?? null;
        return cleanup;
      }, [effect]),
  };
});

const { usePosition } = await import('./use-position');
const { useLocationStore } = await import('./location-store');

describe('the device’s position on a screen in front', () => {
  beforeEach(() => {
    resetPhone();
    useLocationStore.setState({ permission: 'unknown', position: null });
  });

  it('watches while the screen is in front, shows each fix, and stops when it leaves', async () => {
    const rendered = await renderHook(() => usePosition());
    await settle();
    expect(rendered.current()).toBeNull();
    act(() =>
      phone.watchers.at(-1)!({ coords: { latitude: 1, longitude: 2, accuracy: 5 }, timestamp: 3 }),
    );
    expect(rendered.current()).toMatchObject({ lat: 1, lng: 2, accuracyM: 5 });
    rendered.unmount();
    expect(phone.watchers).toHaveLength(0);
  });

  it('stops a watch that starts after the screen already left', async () => {
    const rendered = await renderHook(() => usePosition());
    rendered.unmount();
    await settle();
    expect(phone.watchers).toHaveLength(0);
  });

  it('reads the permission again when the app comes back from the phone’s settings', async () => {
    phone.foreground = { granted: false, canAskAgain: false };
    const rendered = await renderHook(() => usePosition());
    await settle();
    expect(useLocationStore.getState().permission).toBe('denied');
    phone.foreground = { granted: true, canAskAgain: true };
    act(() => nativeFake.appState.emit('background'));
    await settle();
    expect(useLocationStore.getState().permission).toBe('denied');
    act(() => nativeFake.appState.emit('active'));
    await settle();
    expect(useLocationStore.getState().permission).toBe('granted');
    // The new permission starts the watch at once.
    expect(phone.watchers.length).toBeGreaterThan(0);
    rendered.unmount();
    expect(nativeFake.appState.size()).toBe(0);
  });
});
