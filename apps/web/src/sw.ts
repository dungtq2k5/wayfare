/// <reference lib="webworker" />
// The web app's service worker (K11, architecture §4.2): the shell precached; pages and reads
// network-first, so what was opened stays; photos and played audio cache-first with expiry. No packs.
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import {
  CacheableResponsePlugin,
  CacheFirst,
  createPartialResponse,
  ExpirationPlugin,
  NetworkFirst,
  Serwist,
} from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const DAY_S = 86_400;
const AUDIO_CACHE = 'wayfare-audio';

/**
 * A story's audio (K11): the element asks for byte ranges, which a cache can't hold as they come.
 * The whole file is fetched and stored once, then each range is cut from it, so cached audio seeks
 * on an iPhone and plays offline. The live reading's ticket URL is never stored: it is spent once.
 */
async function audioFromCache(request: Request): Promise<Response> {
  const cache = await caches.open(AUDIO_CACHE);
  let full = await cache.match(request.url);
  if (full === undefined) {
    // CORS, so the response is readable (the bucket allows the web's origins) — an opaque one
    // can't be cut into ranges and counts padded against the quota.
    const fetched = await fetch(request.url, { mode: 'cors', credentials: 'omit' });
    if (fetched.status !== 200) return fetched;
    await cache.put(request.url, fetched.clone()).catch(() => undefined);
    full = fetched;
  }
  return request.headers.has('range') ? createPartialResponse(request, full) : full;
}

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ request, url }) =>
        request.destination === 'audio' && !url.pathname.includes('/narration/tts/stream'),
      handler: ({ request }) => audioFromCache(request),
    },
    {
      matcher: ({ request }) => request.destination === 'image',
      handler: new CacheFirst({
        cacheName: 'wayfare-photos',
        plugins: [
          new CacheableResponsePlugin({ statuses: [0, 200] }),
          new ExpirationPlugin({
            maxEntries: 400,
            maxAgeSeconds: 30 * DAY_S,
            purgeOnQuotaError: true,
          }),
        ],
      }),
    },
    {
      // The reads a Place opened needs again offline: its detail, its narration, the areas.
      matcher: ({ request, url }) =>
        request.method === 'GET' &&
        /\/api\/v1\/(places\/(?!nearby)|narration\/places\/|areas|i18n\/)/.test(url.pathname),
      handler: new NetworkFirst({
        cacheName: 'wayfare-reads',
        networkTimeoutSeconds: 6,
        plugins: [
          new CacheableResponsePlugin({ statuses: [200] }),
          new ExpirationPlugin({
            maxEntries: 300,
            maxAgeSeconds: 30 * DAY_S,
            purgeOnQuotaError: true,
          }),
        ],
      }),
    },
    {
      matcher: ({ request }) => request.mode === 'navigate',
      handler: new NetworkFirst({
        cacheName: 'wayfare-pages',
        networkTimeoutSeconds: 6,
        plugins: [
          new CacheableResponsePlugin({ statuses: [200] }),
          new ExpirationPlugin({
            maxEntries: 100,
            maxAgeSeconds: 30 * DAY_S,
            purgeOnQuotaError: true,
          }),
        ],
      }),
    },
  ],
  // WO2b: a page never opened here, while offline.
  fallbacks: {
    entries: [{ url: '/offline', matcher: ({ request }) => request.destination === 'document' }],
  },
});

serwist.addEventListeners();
