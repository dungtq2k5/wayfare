import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nativeFake, Platform } from '../testing/react-native';
import { expoLocation, phone, resetPhone } from '../testing/walk-fakes';

vi.mock('expo-location', async () => (await import('../testing/walk-fakes')).expoLocation);
vi.mock('lucide-react-native', () => ({ CircleCheck: 'CircleCheck' }));
vi.mock('../i18n', () => ({ tourist: () => ({ t: (key: string) => key }) }));
vi.mock('expo-sqlite/kv-store', () => ({
  default: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
}));
vi.mock('../state/app-store', async () => {
  const { create } = await import('zustand');
  return { useAppStore: create(() => ({ currentAreaId: 'd1' })) };
});
const toast = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('../ui/toast', () => toast);
vi.mock('./toast-lift', () => ({ walkCardLift: () => 120 }));
const controller = vi.hoisted(() => ({
  dispatch: vi.fn(),
  applyBackgroundPermission: vi.fn(),
}));
vi.mock('./controller', () => controller);
/** The start flow's answers, scripted by the test; its own rules are permissions.spec's. */
const flow = vi.hoisted(
  (): { outcome: { kind: string; background?: boolean }; granted: boolean } => ({
    outcome: { kind: 'ready', background: true },
    granted: true,
  }),
);
vi.mock('./permissions', () => ({
  runStartFlow: vi.fn(() => Promise.resolve(flow.outcome)),
  grantBackground: vi.fn((_deps: unknown, _force: boolean) => Promise.resolve(flow.granted)),
}));

const { allowBackground, platformDeps, startWalk } = await import('./start');
const { useWalkStore } = await import('./store');
const { useWalkFlags } = await import('./flags');
const permissions = await import('./permissions');

describe('Start walk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWalkStore.setState({
      walk: { ...useWalkStore.getState().walk, phase: 'off' },
      simulated: true,
    });
    flow.outcome = { kind: 'ready', background: true };
  });

  it('begins in the current area, runs the permission flow, and says the walk is on', async () => {
    await startWalk();
    expect(controller.dispatch.mock.calls.map(([event]) => event as object)).toEqual([
      { type: 'begin', areaId: 'd1' },
      { type: 'ready', background: true },
    ]);
    expect(useWalkStore.getState().simulated).toBe(false);
    expect(toast.showToast.mock.calls[0]![0]).toBe('walk.toast.on');
    expect(toast.showToast.mock.calls[0]![3]).toEqual({ icon: 'CircleCheck', lift: 120 });
  });

  it('starts a while-open walk without the toast when the background is refused', async () => {
    flow.outcome = { kind: 'ready', background: false };
    await startWalk();
    expect(controller.dispatch).toHaveBeenLastCalledWith({ type: 'ready', background: false });
    expect(toast.showToast).not.toHaveBeenCalled();
  });

  it('abandons the walk when the tourist leaves the flow', async () => {
    flow.outcome = { kind: 'abandoned' };
    await startWalk();
    expect(controller.dispatch).toHaveBeenLastCalledWith({ type: 'abandon' });
  });

  it('does nothing on a second tap while a walk runs, and starts again after one ended', async () => {
    useWalkStore.setState({ walk: { ...useWalkStore.getState().walk, phase: 'on' } });
    await startWalk();
    expect(permissions.runStartFlow).not.toHaveBeenCalled();
    useWalkStore.setState({ walk: { ...useWalkStore.getState().walk, phase: 'ended' } });
    await startWalk();
    expect(permissions.runStartFlow).toHaveBeenCalledTimes(1);
  });

  it('asks for the background from Settings, forcing the explainer, and moves the walk', async () => {
    flow.granted = false;
    expect(await allowBackground()).toBe(false);
    expect(vi.mocked(permissions.grantBackground).mock.calls[0]![1]).toBe(true);
    expect(controller.applyBackgroundPermission).toHaveBeenCalledWith(false);
  });
});

describe('the platform behind the start flow', () => {
  beforeEach(() => {
    resetPhone();
    useWalkFlags.setState({ backgroundExplained: false, notificationsExplained: false });
  });

  it('reads and asks the foreground permission, and refreshes the map’s copy after asking', async () => {
    phone.foreground = { granted: false, canAskAgain: true };
    expect(await platformDeps.foreground()).toEqual({ granted: false, canAskAgain: true });
    expect(await platformDeps.requestForeground()).toEqual({ granted: false, canAskAgain: true });
    expect(expoLocation.getForegroundPermissionsAsync).toHaveBeenCalledTimes(2);
  });

  it('reads the background, and asks for it by Android’s settings page', async () => {
    phone.backgroundGranted = false;
    expect(await platformDeps.background()).toBe(false);
    phone.backgroundGranted = true;
    expect(await platformDeps.requestBackground()).toBe(true);
    expect(expoLocation.requestBackgroundPermissionsAsync).toHaveBeenCalled();
  });

  it('asks for notifications only on Android 13 and later, and only when not granted', async () => {
    nativeFake.permission = 'denied';
    expect(await platformDeps.notificationsNeedAsking()).toBe(true);
    nativeFake.permission = 'granted';
    expect(await platformDeps.notificationsNeedAsking()).toBe(false);
    nativeFake.permission = 'denied';
    Platform.Version = 32;
    expect(await platformDeps.notificationsNeedAsking()).toBe(false);
    Platform.Version = 34;
    Platform.OS = 'ios';
    expect(await platformDeps.notificationsNeedAsking()).toBe(false);
    Platform.OS = 'android';
    await platformDeps.requestNotifications();
    nativeFake.permission = 'granted';
  });

  it('opens the app’s settings, and keeps what this install was already told', () => {
    platformDeps.openAppSettings();
    platformDeps.mark('backgroundExplained');
    expect(platformDeps.flags()).toMatchObject({
      backgroundExplained: true,
      notificationsExplained: false,
    });
  });
});
