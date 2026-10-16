import { ApiError, NETWORK_ERROR_CODE } from '@wayfare/api-client';
import type { Language } from '@wayfare/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BundleOutcome } from './bundles';
import type { SwitchDeps } from './switch';

vi.mock('expo-sqlite/kv-store', () => ({
  default: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
}));

const { useAppStore } = await import('../state/app-store');
const {
  cancelSwitch,
  chooseFirstLanguage,
  canSwitchNow,
  hotsetDelay,
  resumeSwitch,
  retrySwitch,
  startLanguageSwitch,
  switchNow,
  switchTo,
  useSwitchStore,
} = await import('./switch');

/** Lets every pending promise callback run. */
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Deps whose every answer the test gives by hand; waits only end when the test says so. */
function fakes(overrides: Partial<SwitchDeps> = {}) {
  const waits: { ms: number; done: () => void }[] = [];
  const ui = deferred<BundleOutcome>();
  const sync = deferred<void>();
  const hotset = deferred<{ ready: number; required: number }>();
  const registered = deferred<void>();
  registered.resolve();
  const holds = { holdHotset: false, failNext: false };
  const deps = {
    now: vi.fn(() => 0),
    wait: vi.fn(
      (ms: number) =>
        new Promise<void>((resolve) => {
          waits.push({ ms, done: resolve });
        }),
    ),
    online: vi.fn(() => Promise.resolve(true)),
    bundled: vi.fn((lang: Language) => lang === 'en' || lang === 'vi'),
    uiFromPhone: vi.fn((lang: Language) => Promise.resolve(lang === 'en' || lang === 'vi')),
    loadUi: vi.fn<SwitchDeps['loadUi']>(() => ui.promise),
    syncedLike: vi.fn(() => Promise.resolve(false)),
    sync: vi.fn(() => sync.promise),
    hotset: vi.fn(() => hotset.promise),
    registered: vi.fn(() => registered.promise),
    completed: vi.fn(),
    holds: () => holds,
    clearFailNext: vi.fn(() => {
      holds.failNext = false;
    }),
    ...overrides,
  };
  return { deps, waits, ui, sync, hotset, holds };
}

const store = () => useAppStore.getState();

beforeEach(() => {
  cancelSwitch();
  useAppStore.setState({ language: 'en', pendingLanguage: null, switchStartedAt: null });
  useSwitchStore.setState({ screensPending: null });
});

describe('the language switch', () => {
  it('keeps the old language until both lanes are ready, then changes it in one update', async () => {
    const f = fakes();
    startLanguageSwitch(f.deps);
    const updates: unknown[] = [];
    const unsubscribe = useAppStore.subscribe((state) => updates.push(state.language));
    switchTo('ja');
    await flush();
    expect(store().language).toBe('en');
    // The loader keeps fetching while i18next stays on English: the switch wants the language.
    const options = vi.mocked(f.deps.loadUi).mock.calls[0]?.[1];
    expect(options?.isWanted('ja')).toBe(true);
    f.ui.resolve('ready');
    f.sync.resolve();
    await flush();
    expect(useSwitchStore.getState()).toMatchObject({ ui: 'ready', synced: true });
    expect(store().language).toBe('en');
    updates.length = 0;
    f.hotset.resolve({ ready: 3, required: 3 });
    await flush();
    expect(store()).toMatchObject({ language: 'ja', pendingLanguage: null, switchStartedAt: null });
    expect(updates).toEqual(['ja']);
    expect(f.deps.completed).toHaveBeenCalledWith('ja', { offline: false, toast: true });
    unsubscribe();
  });

  it('shows "n of 3" while the hotset is not ready, then asks again', async () => {
    const f = fakes({
      hotset: vi
        .fn()
        .mockResolvedValueOnce({ ready: 1, required: 3 })
        .mockResolvedValue({ ready: 4, required: 3 }),
    });
    startLanguageSwitch(f.deps);
    switchTo('ja');
    f.ui.resolve('ready');
    f.sync.resolve();
    await flush();
    expect(useSwitchStore.getState().ready).toBe(1);
    expect(store().language).toBe('en');
    f.waits.find((w) => w.ms === 5_000)?.done();
    await flush();
    expect(store().language).toBe('ja');
  });

  it('a server error fails the switch; a network error waits for a connection, then resumes', async () => {
    const f = fakes();
    startLanguageSwitch(f.deps);
    switchTo('ja');
    f.ui.resolve('failed');
    await flush();
    expect(useSwitchStore.getState().phase).toBe('failed');
    expect(store().language).toBe('en');

    const g = fakes({
      sync: vi.fn(() => Promise.reject(new ApiError(0, NETWORK_ERROR_CODE, '-'))),
    });
    startLanguageSwitch(g.deps);
    await flush();
    expect(useSwitchStore.getState().phase).toBe('offline');
    // The connection returns: the run starts again and completes.
    vi.mocked(g.deps.sync).mockResolvedValue(undefined);
    vi.mocked(g.deps.hotset).mockResolvedValue({ ready: 3, required: 3 });
    g.ui.resolve('ready');
    resumeSwitch();
    await flush();
    expect(store().language).toBe('ja');
  });

  it('a hotset error other than the network is a failure; *Try again* runs the lanes again', async () => {
    const f = fakes({
      hotset: vi.fn().mockRejectedValueOnce(new ApiError(500, 'INTERNAL', '-')),
    });
    startLanguageSwitch(f.deps);
    switchTo('ja');
    f.ui.resolve('ready');
    f.sync.resolve();
    await flush();
    expect(useSwitchStore.getState().phase).toBe('failed');
    vi.mocked(f.deps.hotset).mockResolvedValue({ ready: 3, required: 3 });
    retrySwitch();
    await flush();
    expect(store().language).toBe('ja');
  });

  it('a 429 waits for its Retry-After', async () => {
    const f = fakes({
      hotset: vi
        .fn()
        .mockRejectedValueOnce(new ApiError(429, 'RATE_LIMITED', '-', { retryAfterSeconds: 42 })),
    });
    startLanguageSwitch(f.deps);
    switchTo('ja');
    f.ui.resolve('ready');
    f.sync.resolve();
    await flush();
    expect(f.waits.map((w) => w.ms)).toContain(42_000);
    expect(useSwitchStore.getState().phase).toBe('running');
  });

  it('cancel and replace drop the old switch’s late answers', async () => {
    const f = fakes();
    startLanguageSwitch(f.deps);
    switchTo('ja');
    await flush();
    switchTo('ko');
    expect(store().pendingLanguage).toBe('ko');
    f.ui.resolve('ready');
    f.sync.resolve();
    f.hotset.resolve({ ready: 3, required: 3 });
    await flush();
    // The same answers serve both runs here; only the replacing one may complete.
    expect(store().language).toBe('ko');
    expect(f.deps.completed).toHaveBeenCalledTimes(1);

    const g = fakes();
    startLanguageSwitch(g.deps);
    switchTo('ja');
    await flush();
    switchTo('ko'); // the current language: cancels
    expect(store().pendingLanguage).toBeNull();
    g.ui.resolve('ready');
    g.sync.resolve();
    g.hotset.resolve({ ready: 3, required: 3 });
    await flush();
    expect(store().language).toBe('ko');
    expect(g.deps.completed).not.toHaveBeenCalled();
  });

  it('*Switch now* is offered after the patience, only with the words and the sync', async () => {
    const f = fakes({ hotset: vi.fn(() => Promise.resolve({ ready: 0, required: 3 })) });
    startLanguageSwitch(f.deps);
    switchTo('ja');
    await flush();
    f.waits.find((w) => w.ms === 30_000)?.done();
    await flush();
    expect(useSwitchStore.getState().phase).toBe('slow');
    expect(canSwitchNow('ja', useSwitchStore.getState())).toBe(false);
    f.ui.resolve('ready');
    await flush();
    expect(canSwitchNow('ja', useSwitchStore.getState())).toBe(false); // not synced
    f.sync.resolve();
    await flush();
    expect(canSwitchNow('ja', useSwitchStore.getState())).toBe(true);
    switchNow();
    expect(store().language).toBe('ja');
  });

  it('a language on the phone completes at once, online and offline', async () => {
    const online = fakes({ syncedLike: vi.fn(() => Promise.resolve(true)) });
    startLanguageSwitch(online.deps);
    switchTo('vi');
    await flush();
    expect(store().language).toBe('vi');
    expect(online.deps.completed).toHaveBeenCalledWith('vi', { offline: false, toast: true });
    expect(online.deps.sync).toHaveBeenCalledWith('vi'); // catching up in the background
    expect(online.deps.hotset).not.toHaveBeenCalled();

    const offline = fakes({
      syncedLike: vi.fn(() => Promise.resolve(true)),
      uiFromPhone: vi.fn(() => Promise.resolve(true)),
      online: vi.fn(() => Promise.resolve(false)),
    });
    startLanguageSwitch(offline.deps);
    switchTo('ja');
    await flush();
    expect(store().language).toBe('ja');
    expect(offline.deps.completed).toHaveBeenCalledWith('ja', { offline: true, toast: true });
  });

  it('a language not on the phone, offline, waits and changes nothing', async () => {
    const f = fakes({ online: vi.fn(() => Promise.resolve(false)) });
    startLanguageSwitch(f.deps);
    switchTo('ko');
    await flush();
    expect(useSwitchStore.getState().phase).toBe('offline');
    expect(store()).toMatchObject({ language: 'en', pendingLanguage: 'ko' });
    expect(f.deps.sync).not.toHaveBeenCalled();
  });

  it('a switch persisted by an earlier launch resumes', async () => {
    useAppStore.setState({ pendingLanguage: 'ja', switchStartedAt: 1 });
    const f = fakes();
    startLanguageSwitch(f.deps);
    f.ui.resolve('ready');
    f.sync.resolve();
    f.hotset.resolve({ ready: 3, required: 3 });
    await flush();
    expect(store().language).toBe('ja');
  });

  it('*Fail the next switch* fails it once', async () => {
    const f = fakes();
    f.holds.failNext = true;
    startLanguageSwitch(f.deps);
    switchTo('ja');
    await flush();
    expect(useSwitchStore.getState().phase).toBe('failed');
    expect(f.holds.failNext).toBe(false);
  });
});

describe('the long tail', () => {
  it('completes with its screens in English while its words translate', async () => {
    const f = fakes({
      loadUi: vi.fn<SwitchDeps['loadUi']>((_lang, options) => {
        options.onPending('fr');
        return new Promise<BundleOutcome>(() => undefined);
      }),
    });
    startLanguageSwitch(f.deps);
    switchTo('fr');
    f.sync.resolve();
    f.hotset.resolve({ ready: 3, required: 3 });
    await flush();
    expect(store().language).toBe('fr');
    expect(useSwitchStore.getState().screensPending).toBe('fr');
    // Its toast waits for the words.
    expect(f.deps.completed).toHaveBeenCalledWith('fr', { offline: false, toast: false });
  });

  it('a launch language translating does not complete', async () => {
    const f = fakes({
      loadUi: vi.fn<SwitchDeps['loadUi']>((_lang, options) => {
        options.onPending('ja');
        return new Promise<BundleOutcome>(() => undefined);
      }),
    });
    startLanguageSwitch(f.deps);
    switchTo('ja');
    f.sync.resolve();
    f.hotset.resolve({ ready: 3, required: 3 });
    await flush();
    expect(store().language).toBe('en');
  });
});

describe('the first run', () => {
  it('fetches the words at once, but the content lane waits for registration', async () => {
    useAppStore.setState({ pendingLanguage: 'ja' });
    const registered = deferred<void>();
    const f = fakes({ registered: vi.fn(() => registered.promise) });
    startLanguageSwitch(f.deps);
    await flush();
    expect(f.deps.loadUi).toHaveBeenCalled();
    expect(f.deps.sync).not.toHaveBeenCalled();
    registered.resolve();
    await flush();
    expect(f.deps.sync).toHaveBeenCalledWith('ja');
  });
});

describe('hotsetDelay', () => {
  it('asks every 5 s for the first 30 s, then every 60 s', () => {
    expect(hotsetDelay(0)).toBe(5_000);
    expect(hotsetDelay(29_999)).toBe(5_000);
    expect(hotsetDelay(30_000)).toBe(60_000);
  });
});

describe('the first run’s picker', () => {
  it('sets a language the app carries at once', () => {
    useAppStore.setState({ language: null });
    chooseFirstLanguage('vi', true);
    expect(store()).toMatchObject({ language: 'vi', pendingLanguage: null });
  });

  it('starts any other in English, with a switch to it', () => {
    useAppStore.setState({ language: null });
    startLanguageSwitch(fakes().deps);
    chooseFirstLanguage('ja', false);
    expect(store()).toMatchObject({ language: 'en', pendingLanguage: 'ja', switchFirstRun: true });
  });
});
