import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  cache: <T>(fn: T) => fn,
}));
const request = vi.hoisted(() => ({ cookie: undefined as string | undefined, accept: 'ja' }));
vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({ get: () => (request.cookie ? { value: request.cookie } : undefined) }),
  headers: () => Promise.resolve({ get: () => request.accept }),
}));
vi.mock('../env', () => ({ GATEWAY_INTERNAL_URL: 'http://gateway', SERVER_CACHE_SECONDS: 60 }));

const { messagesFor, requestLanguage, serverTranslator } = await import('./server');
const { BUNDLED, ENGLISH } = await import('./messages');

const answer = (messages: Record<string, string>, ok = true) =>
  Promise.resolve({ ok, json: () => Promise.resolve({ data: { messages } }) } as Response);

describe('the page’s language and strings on the server (K7)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads the language from the cookie first, then the browser’s Accept-Language', async () => {
    request.cookie = 'vi';
    expect((await requestLanguage()).lang).toBe('vi');
    request.cookie = undefined;
    request.accept = 'en-GB,en;q=0.8';
    expect((await requestLanguage()).lang).toBe('en');
  });

  it('serves a shipped language from the bundle, with no request', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await messagesFor('vi')).toBe(BUNDLED.vi);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads another language from the pipeline, its missing keys in English', async () => {
    const fetch = vi.fn((url: string) =>
      url.endsWith('/web/ja')
        ? answer({ 'fav.undo': '元に戻す' })
        : answer({ 'category.CAFE': 'カフェ', 'player.play': 'not shared' }),
    );
    vi.stubGlobal('fetch', fetch);
    const messages = await messagesFor('ja');
    expect(fetch).toHaveBeenCalledWith('http://gateway/api/v1/i18n/bundles/web/ja', {
      headers: { 'x-wayfare-client': 'web' },
      next: { revalidate: 60 },
    });
    expect(messages['fav.undo']).toBe('元に戻す');
    expect(messages['category.CAFE']).toBe('カフェ');
    expect(messages['player.play']).toBe(ENGLISH['player.play']);
  });

  it('falls back to English when the pipeline refuses or can’t be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.includes('/web/') ? answer({}, false) : Promise.reject(new Error('down')),
      ),
    );
    expect(await messagesFor('ko')).toEqual(ENGLISH);
  });

  it('gives a server component the translator of the request’s language', async () => {
    request.cookie = 'vi';
    const translator = await serverTranslator();
    expect(translator.locale).toBe('vi');
    expect(translator.t('fav.undo')).toBe(BUNDLED.vi!['fav.undo']);
  });
});
