import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Route {
  matcher: (context: { request: Record<string, unknown>; url: URL }) => boolean;
  handler: unknown;
}

const serwist = vi.hoisted(() => ({
  options: null as null | {
    runtimeCaching: Route[];
    fallbacks: { entries: { url: string; matcher: Route['matcher'] }[] };
    precacheEntries: unknown;
  },
  listening: false,
  partial: vi.fn((_request: Request, full: Response) => ({ partOf: full })),
}));
vi.mock('serwist', () => {
  const named = (name: string) =>
    class {
      readonly kind = name;
      constructor(readonly options: unknown) {}
    };
  return {
    CacheableResponsePlugin: named('CacheableResponsePlugin'),
    CacheFirst: named('CacheFirst'),
    ExpirationPlugin: named('ExpirationPlugin'),
    NetworkFirst: named('NetworkFirst'),
    createPartialResponse: serwist.partial,
    Serwist: class {
      constructor(options: typeof serwist.options) {
        serwist.options = options;
      }
      addEventListeners() {
        serwist.listening = true;
      }
    },
  };
});

const stored = new Map<string, unknown>();
const audioCache = {
  match: vi.fn((url: string) => Promise.resolve(stored.get(url))),
  put: vi.fn((url: string, response: unknown) => {
    stored.set(url, response);
    return Promise.resolve();
  }),
};
const network = vi.fn();
vi.stubGlobal('self', { __SW_MANIFEST: ['/offline'] });
vi.stubGlobal('caches', { open: vi.fn(() => Promise.resolve(audioCache)) });
vi.stubGlobal('fetch', network);

await import('./sw');
const options = serwist.options!;
const [audio, photos, reads, pages] = options.runtimeCaching;

const request = (fields: Record<string, unknown>) => ({
  method: 'GET',
  destination: '',
  mode: 'cors',
  ...fields,
});
const at = (path: string) => new URL(`https://wayfare.test${path}`);
const audioRequest = (range: boolean) =>
  ({
    url: 'https://media.test/a.mp3',
    headers: new Headers(range ? { range: 'bytes=0-' } : {}),
  }) as Request;
const response = (status: number) => ({ status, clone: () => ({ status, copy: true }) });

describe('the web app’s service worker (K11)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stored.clear();
  });

  it('precaches the shell and listens', () => {
    expect(options.precacheEntries).toEqual(['/offline']);
    expect(serwist.listening).toBe(true);
  });

  it('keeps a story’s audio, but never the live reading’s spent ticket', () => {
    expect(audio!.matcher({ request: request({ destination: 'audio' }), url: at('/a.mp3') })).toBe(
      true,
    );
    expect(
      audio!.matcher({
        request: request({ destination: 'audio' }),
        url: at('/api/v1/narration/tts/stream/tk'),
      }),
    ).toBe(false);
  });

  it('fetches a story’s audio whole once, then cuts each range from the kept file', async () => {
    const handle = audio!.handler as (context: { request: Request }) => Promise<unknown>;
    network.mockResolvedValueOnce(response(200));
    const first = await handle({ request: audioRequest(true) });
    expect(network).toHaveBeenCalledWith('https://media.test/a.mp3', {
      mode: 'cors',
      credentials: 'omit',
    });
    expect(first).toMatchObject({ partOf: { status: 200 } });
    const again = await handle({ request: audioRequest(false) });
    expect(network).toHaveBeenCalledTimes(1);
    expect(again).toEqual({ status: 200, copy: true });
  });

  it('keeps no failed audio, and plays it even when the cache refuses it', async () => {
    const handle = audio!.handler as (context: { request: Request }) => Promise<unknown>;
    network.mockResolvedValueOnce(response(403));
    expect(await handle({ request: audioRequest(false) })).toMatchObject({ status: 403 });
    expect(audioCache.put).not.toHaveBeenCalled();
    network.mockResolvedValueOnce(response(200));
    audioCache.put.mockRejectedValueOnce(new Error('quota'));
    expect(await handle({ request: audioRequest(false) })).toMatchObject({ status: 200 });
  });

  it('keeps photos, a Place’s reads (never the nearby list) and pages, each for 30 days', () => {
    expect(photos!.matcher({ request: request({ destination: 'image' }), url: at('/p.jpg') })).toBe(
      true,
    );
    const read = (path: string, method = 'GET') =>
      reads!.matcher({ request: request({ method }), url: at(path) });
    expect(read('/api/v1/places/BT1')).toBe(true);
    expect(read('/api/v1/narration/places/p1')).toBe(true);
    expect(read('/api/v1/areas')).toBe(true);
    expect(read('/api/v1/i18n/bundles/web/ja')).toBe(true);
    expect(read('/api/v1/places/nearby')).toBe(false);
    expect(read('/api/v1/places/BT1', 'POST')).toBe(false);
    expect(pages!.matcher({ request: request({ mode: 'navigate' }), url: at('/p/BT1') })).toBe(
      true,
    );
    expect(pages!.matcher({ request: request({}), url: at('/p/BT1') })).toBe(false);
  });

  it('shows the offline page for a page never opened here', () => {
    const [fallback] = options.fallbacks.entries;
    expect(fallback!.url).toBe('/offline');
    expect(
      fallback!.matcher({ request: request({ destination: 'document' }), url: at('/x') }),
    ).toBe(true);
    expect(fallback!.matcher({ request: request({ destination: 'image' }), url: at('/x') })).toBe(
      false,
    );
  });
});
