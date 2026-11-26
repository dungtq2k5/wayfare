import { ApiError, NETWORK_ERROR_CODE } from '@wayfare/api-client';
import en from '@wayfare/i18n/locales/en/tourist.json';
import vi from '@wayfare/i18n/locales/vi/tourist.json';
import { beforeEach, describe, expect, it, vi as mock } from 'vitest';

mock.mock('expo-sqlite/kv-store', async () => ({
  default: (await import('../testing/account-fakes')).memoryKv,
}));
/** The phone's documents folder, in memory. */
const files = mock.hoisted(() => {
  const written = new Map<string, string>();
  const dirs = new Set<string>();
  const join = (parts: string[]) => parts.join('/');
  return {
    written,
    dirs,
    locales: [{ languageTag: 'vi-VN' }] as { languageTag: string }[],
    module: {
      Paths: { document: 'doc' },
      File: class {
        readonly key: string;
        constructor(...parts: string[]) {
          this.key = join(parts);
        }
        get exists() {
          return written.has(this.key);
        }
        text() {
          return Promise.resolve(written.get(this.key)!);
        }
        write(content: string) {
          written.set(this.key, content);
        }
      },
      Directory: class {
        readonly key: string;
        constructor(...parts: string[]) {
          this.key = join(parts);
        }
        get exists() {
          return dirs.has(this.key);
        }
        create() {
          dirs.add(this.key);
        }
      },
    },
  };
});
mock.mock('expo-file-system', () => files.module);
mock.mock('expo-localization', () => ({ getLocales: () => files.locales }));
const api = mock.hoisted(() => ({
  i18nBundle: mock.fn<(namespace: string, locale: string, query?: object) => Promise<unknown>>(),
}));
mock.mock('@wayfare/api-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));

const i18n = await import('./index');
const i18next = i18n.default;
const { useAppStore } = await import('../state/app-store');
const { useSwitchHolds } = await import('./switch-holds');

const ready = (messages: Record<string, string>, sourceHash = 'h1') => ({
  data: { status: 'READY', sourceHash, messages, retryAfterMs: null },
});
const anyKey = Object.keys(en).find((key) => key.startsWith('error.') && key !== 'error.generic')!;

describe('the app’s words (i18next, K1)', () => {
  beforeEach(() => {
    api.i18nBundle.mockReset();
    files.written.clear();
    files.dirs.clear();
    useSwitchHolds.setState({ holdBundle: false });
    useAppStore.setState({ language: 'ja', pendingLanguage: null });
  });

  it('starts in the phone’s own language when the app ships it', () => {
    expect(i18next.language).toBe('vi');
    expect(i18n.isBundled('vi')).toBe(true);
    expect(i18n.isBundled('ja')).toBe(false);
  });

  it('starts in English when the phone’s language isn’t shipped, or it has none', async () => {
    for (const locales of [[{ languageTag: 'ja-JP' }], []]) {
      files.locales = locales;
      mock.resetModules();
      const fresh = await import('./index');
      expect(fresh.default.language).toBe('en');
    }
    files.locales = [{ languageTag: 'vi-VN' }];
  });

  it('brings a language’s words from the server, keeping them on the phone for next time', async () => {
    api.i18nBundle.mockResolvedValue(ready({ 'fav.empty': 'お気に入りなし' }));
    expect(await i18n.loadUi('ja')).toBe('ready');
    expect(api.i18nBundle).toHaveBeenCalledWith('tourist', 'ja', undefined);
    expect(i18next.getResource('ja', 'tourist', 'fav.empty')).toBe('お気に入りなし');
    expect(files.dirs.has('doc/ui-bundles')).toBe(true);
    expect(JSON.parse(files.written.get('doc/ui-bundles/tourist.ja.json')!)).toEqual({
      sourceHash: 'h1',
      messages: { 'fav.empty': 'お気に入りなし' },
    });
    api.i18nBundle.mockResolvedValue(ready({ 'fav.empty': 'x' }, 'h2'));
    await i18n.loadUi('ja');
    expect(api.i18nBundle).toHaveBeenLastCalledWith('tourist', 'ja', { sourceHash: 'h1' });
  });

  it('answers as still translating while Diagnostics holds the bundle', async () => {
    mock.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      useSwitchHolds.setState({ holdBundle: true });
      api.i18nBundle.mockResolvedValue(ready({ 'fav.empty': 'held' }));
      const pending = mock.fn();
      const outcome = i18n.loadUi('ja', {
        onPending: pending,
        isWanted: () => pending.mock.calls.length === 0,
      });
      await mock.advanceTimersByTimeAsync(5_000);
      expect(await outcome).toBe('pending');
      expect(pending).toHaveBeenCalledWith('ja');
      expect(i18next.getResource('ja', 'tourist', 'fav.empty')).not.toBe('held');
    } finally {
      mock.useRealTimers();
    }
  });

  it('stops waiting once nobody wants the language: neither on screen nor switched to', async () => {
    api.i18nBundle.mockResolvedValue({
      data: { status: 'PENDING', sourceHash: 'h', messages: {}, retryAfterMs: 1 },
    });
    useAppStore.setState({ language: 'ja' });
    const outcome = i18n.loadUi('ko');
    expect(await outcome).toBe('pending');
    expect(api.i18nBundle).not.toHaveBeenCalled();
    useAppStore.setState({ language: 'vi', pendingLanguage: 'ko' });
    let calls = 0;
    api.i18nBundle.mockImplementation(() => {
      calls += 1;
      if (calls === 2) useAppStore.setState({ pendingLanguage: null });
      return Promise.resolve({
        data: { status: 'PENDING', sourceHash: 'h', messages: {}, retryAfterMs: 1 },
      });
    });
    expect(await i18n.loadUi('ko')).toBe('pending');
    expect(calls).toBe(2);
  });

  it('knows a language’s words are on the phone when shipped or kept, and reads the kept ones in', async () => {
    expect(await i18n.uiFromPhone('en')).toBe(true);
    expect(await i18n.uiFromPhone('th')).toBe(false);
    files.written.set(
      'doc/ui-bundles/tourist.th.json',
      JSON.stringify({ sourceHash: 'h', messages: { 'fav.empty': 'ไม่มี' } }),
    );
    expect(await i18n.uiFromPhone('th')).toBe(true);
    expect(i18next.getResource('th', 'tourist', 'fav.empty')).toBe('ไม่มี');
    files.written.set('doc/ui-bundles/tourist.ru.json', '{broken');
    expect(await i18n.uiFromPhone('ru')).toBe(false);
  });

  it('shows a shipped language at once, with no request', async () => {
    const landed = mock.fn();
    await i18n.showLanguage('en', landed);
    expect(i18next.language).toBe('en');
    expect(api.i18nBundle).not.toHaveBeenCalled();
    expect(landed).not.toHaveBeenCalled();
  });

  it('redraws a long tail’s screens when its words land, and says so', async () => {
    useAppStore.setState({ language: 'ja' });
    api.i18nBundle.mockResolvedValue(ready({ 'fav.empty': 'なし' }));
    const landed = mock.fn();
    await i18n.showLanguage('ja', landed);
    expect(i18next.language).toBe('ja');
    expect(landed).toHaveBeenCalledWith('ja');
  });

  it('says nothing landed when the words can’t be fetched, or the language moved on meanwhile', async () => {
    const landed = mock.fn();
    api.i18nBundle.mockRejectedValueOnce(new ApiError(0, NETWORK_ERROR_CODE, 'offline'));
    useAppStore.setState({ language: 'ko' });
    await i18n.showLanguage('ko', landed);
    api.i18nBundle.mockImplementationOnce(async () => {
      await i18next.changeLanguage('en');
      return ready({ 'fav.empty': 'x' });
    });
    useAppStore.setState({ language: 'fr' });
    await i18n.showLanguage('fr', landed);
    expect(landed).not.toHaveBeenCalled();
  });

  it('says a failed call by its code, the network’s own words offline, the generic ones otherwise', async () => {
    await i18next.changeLanguage('en');
    const code = anyKey.slice('error.'.length);
    expect(i18n.errorMessage(new ApiError(400, code, 'x'))).toBe(en[anyKey as keyof typeof en]);
    expect(i18n.errorMessage(new ApiError(0, NETWORK_ERROR_CODE, 'x'))).toBe(en['error.network']);
    expect(i18n.errorMessage(new ApiError(400, 'NEVER_SEEN', 'x'))).toBe(en['error.generic']);
    expect(i18n.errorMessage(new Error('boom'))).toBe(en['error.generic']);
    await i18next.changeLanguage('vi');
    expect(i18n.tourist().t('error.generic')).toBe(vi['error.generic']);
  });
});
