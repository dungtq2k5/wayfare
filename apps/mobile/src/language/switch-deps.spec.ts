// @vitest-environment happy-dom
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, settle } from '../testing/render-hook';
import type { SwitchDeps } from './switch';

vi.mock('expo-sqlite/kv-store', async () => ({
  default: (await import('../testing/account-fakes')).memoryKv,
}));
vi.mock('expo-location', () => ({}));
vi.mock('lucide-react-native', () => ({ CircleCheck: 'CircleCheck' }));
const db = vi.hoisted(() => ({ kind: 'db' }));
vi.mock('../data/boot', () => ({ databaseReady: Promise.resolve(db) }));
const queries = vi.hoisted(() => ({
  areaSummaries: vi.fn((_db: unknown, _lang: string) => Promise.resolve<{ areaId: string }[]>([])),
  placeById: vi.fn((_db: unknown, _id: string, _lang: string) => Promise.resolve<unknown>(null)),
}));
vi.mock('../data/queries', () => queries);
const network = vi.hoisted(() => ({ checkNetwork: vi.fn(() => Promise.resolve('online')) }));
vi.mock('../network/network-store', () => network);
vi.mock('../places/place-view', () => ({
  viewFromRecord: (record: { id: string }) => ({ view: record.id }),
  playerPlaceOf: (view: { view: string }) => ({ player: view.view }),
}));
const player = vi.hoisted(() => ({
  relanguage: vi.fn((_find: (id: string) => Promise<unknown>) => Promise.resolve()),
}));
vi.mock('../player/narration-player', () => ({ narrationPlayer: player }));
const sync = vi.hoisted(() => ({ runSync: vi.fn((_lang: string) => Promise.resolve()) }));
vi.mock('../sync/run-sync', () => sync);
const toast = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('../ui/toast', () => toast);
const ui = vi.hoisted(() => ({
  default: {
    getFixedT: (lang: string) => (key: string, args: { lang: string }) =>
      `${lang}:${key}:${args.lang}`,
  },
  isBundled: (lang: string) => lang === 'en' || lang === 'vi',
  loadUi: vi.fn(),
  uiFromPhone: vi.fn(),
  NAMESPACE: 'tourist',
  showLanguage: vi.fn((_lang: string, _landed: (lang: string) => void) => Promise.resolve()),
}));
vi.mock('../i18n', () => ui);
const api = vi.hoisted(() => ({
  devicesUpdate: vi.fn((_body: object) => Promise.resolve({})),
  getAreasListQueryKey: () => ['/api/v1/areas'],
  narrationHotset: vi.fn(),
}));
vi.mock('@wayfare/api-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));
const switching = vi.hoisted(() => ({ deps: null as SwitchDeps | null }));
vi.mock('./switch', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  startLanguageSwitch: (deps: SwitchDeps) => {
    switching.deps = deps;
  },
}));

const { useLanguageSwitch } = await import('./switch-deps');
const { useAppStore } = await import('../state/app-store');
const { useLocationStore } = await import('../location/location-store');
const { queryClient } = await import('../state/query-client');
const { useSwitchStore } = await import('./switch');
const { useSwitchHolds } = await import('../i18n/switch-holds');

/** Mounts the hook hydrated, and hands back the switch's deps. */
async function mounted(): Promise<SwitchDeps> {
  useAppStore.setState({ hydrated: true });
  await renderHook(() => useLanguageSwitch());
  await settle();
  return switching.deps!;
}

describe('the language switch’s wiring (the root layout)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    switching.deps = null;
    useAppStore.setState({
      hydrated: false,
      language: null,
      onboarded: false,
      currentAreaId: null,
    });
    useLocationStore.setState({ position: null });
    queryClient.clear();
  });

  it('shows the stored language, and starts the switch once the store is read', async () => {
    useAppStore.setState({ language: 'vi' });
    await renderHook(() => useLanguageSwitch());
    await settle();
    expect(ui.showLanguage).toHaveBeenCalledWith('vi', expect.any(Function));
    expect(switching.deps).toBeNull();
    act(() => {
      useAppStore.setState({ hydrated: true });
    });
    await settle();
    expect(switching.deps).not.toBeNull();
  });

  it('shows nothing before a language is chosen', async () => {
    await mounted();
    expect(ui.showLanguage).not.toHaveBeenCalled();
  });

  it('says the switch is done, in the language reached, when a long tail’s words land', async () => {
    useAppStore.setState({ language: 'ja' });
    await mounted();
    const landed = ui.showLanguage.mock.calls[0]![1];
    useSwitchStore.setState({ screensPending: 'ko' });
    landed('ja');
    expect(toast.showToast).not.toHaveBeenCalled();
    useSwitchStore.setState({ screensPending: 'ja' });
    landed('ja');
    expect(useSwitchStore.getState().screensPending).toBeNull();
    expect(toast.showToast).toHaveBeenCalledWith('ja:switch.done:日本語', undefined, 4_000, {
      icon: 'CircleCheck',
    });
  });

  it('is online only when the gateway answers, and reads the bundled languages', async () => {
    const deps = await mounted();
    expect(await deps.online()).toBe(true);
    network.checkNetwork.mockResolvedValueOnce('offline');
    expect(await deps.online()).toBe(false);
    expect(deps.bundled('vi')).toBe(true);
    expect(deps.bundled('ja')).toBe(false);
    expect(deps.uiFromPhone).toBe(ui.uiFromPhone);
    expect(deps.loadUi).toBe(ui.loadUi);
    await deps.sync('ja');
    expect(sync.runSync).toHaveBeenCalledWith('ja');
    expect(deps.now()).toBeGreaterThan(0);
    await deps.wait(1);
  });

  it('counts the synced areas alike only when every area here is synced in the new language', async () => {
    const deps = await mounted();
    queries.areaSummaries.mockImplementation((_db, lang) =>
      Promise.resolve(lang === 'en' ? [{ areaId: 'd1' }, { areaId: 'd3' }] : [{ areaId: 'd1' }]),
    );
    expect(await deps.syncedLike('ja', 'en')).toBe(false);
    queries.areaSummaries.mockImplementation(() => Promise.resolve([{ areaId: 'd1' }]));
    expect(await deps.syncedLike('ja', 'en')).toBe(true);
    queries.areaSummaries.mockImplementation(() => Promise.resolve([]));
    expect(await deps.syncedLike('ja', 'en')).toBe(false);
  });

  it('asks the hotset from the last position, else the Map’s area, else waits for nothing', async () => {
    const deps = await mounted();
    api.narrationHotset.mockResolvedValue({
      data: { ready: ['a'], pending: ['b', 'c'], requiredReadyCount: 5 },
    });
    expect(await deps.hotset('ja')).toEqual({ ready: 0, required: 0 });
    expect(api.narrationHotset).not.toHaveBeenCalled();
    const areas = {
      data: [
        { id: 'd1', center: { lat: 1, lng: 2 } },
        { id: 'd3', center: { lat: 3, lng: 4 } },
      ],
    };
    queryClient.setQueryData(['/api/v1/areas'], areas);
    await deps.hotset('ja');
    expect(api.narrationHotset).toHaveBeenLastCalledWith({ lat: 1, lng: 2, lang: 'ja' });
    useAppStore.setState({ currentAreaId: 'd3' });
    await deps.hotset('ja');
    expect(api.narrationHotset).toHaveBeenLastCalledWith({ lat: 3, lng: 4, lang: 'ja' });
    useLocationStore.setState({ position: { lat: 9, lng: 8, accuracyM: 5 } });
    // Fewer Places near than the hotset asks for: all of them is enough.
    expect(await deps.hotset('ja')).toEqual({ ready: 1, required: 3 });
    expect(api.narrationHotset).toHaveBeenLastCalledWith({ lat: 9, lng: 8, lang: 'ja' });
  });

  it('waits for the install to be registered before the switch goes on', async () => {
    const deps = await mounted();
    useAppStore.setState({ onboarded: true });
    await deps.registered();
    useAppStore.setState({ onboarded: false });
    let done = false;
    const waiting = deps.registered().then(() => (done = true));
    useAppStore.setState({ language: 'vi' });
    await settle();
    expect(done).toBe(false);
    useAppStore.setState({ onboarded: true });
    await waiting;
    expect(done).toBe(true);
  });

  it('on completion tells the device, says it’s done, and re-languages the player', async () => {
    const deps = await mounted();
    queries.placeById.mockResolvedValueOnce({ id: 'p1' }).mockResolvedValueOnce(null);
    deps.completed('ja', { offline: false, toast: true });
    expect(api.devicesUpdate).toHaveBeenCalledWith({ contentLocale: 'ja' });
    expect(toast.showToast).toHaveBeenCalled();
    const find = player.relanguage.mock.calls[0]![0];
    expect(await find('p1')).toEqual({ player: 'p1' });
    expect(await find('gone')).toBeNull();
    api.devicesUpdate.mockRejectedValueOnce(new Error('offline'));
    deps.completed('vi', { offline: false, toast: false });
    expect(toast.showToast).toHaveBeenCalledTimes(1);
  });

  it('reads Diagnostics’ holds, and clears the one-off failure', async () => {
    const deps = await mounted();
    useSwitchHolds.setState({ failNext: true, holdHotset: true });
    expect(deps.holds()).toMatchObject({ failNext: true, holdHotset: true });
    deps.clearFailNext();
    expect(useSwitchHolds.getState().failNext).toBe(false);
  });
});
