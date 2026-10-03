import { describe, expect, it, vi } from 'vitest';
import { loadBundle, MAX_ATTEMPTS } from './bundles';
import type { BundleLoaderDeps, UiBundle } from './bundles';

const ready: UiBundle = {
  status: 'READY',
  sourceHash: 'h2',
  messages: { 'nav.map': '地図' },
  retryAfterMs: null,
};
const pending: UiBundle = {
  status: 'PENDING',
  sourceHash: 'h2',
  messages: { 'nav.map': 'Map' },
  retryAfterMs: 2_000,
};

function deps(overrides: Partial<BundleLoaderDeps> = {}) {
  const base = {
    fetchBundle: vi.fn<BundleLoaderDeps['fetchBundle']>(() => Promise.resolve(ready)),
    readCache: vi.fn<BundleLoaderDeps['readCache']>(() => Promise.resolve(null)),
    writeCache: vi.fn<BundleLoaderDeps['writeCache']>(() => Promise.resolve()),
    apply: vi.fn<BundleLoaderDeps['apply']>(),
    wait: vi.fn<BundleLoaderDeps['wait']>(() => Promise.resolve()),
  };
  return { ...base, ...overrides } as typeof base;
}

describe('loadBundle', () => {
  it('applies and caches a READY bundle', async () => {
    const d = deps();
    expect(await loadBundle('ja', d)).toBe('ready');
    expect(d.apply).toHaveBeenCalledWith('ja', ready.messages);
    expect(d.writeCache).toHaveBeenCalledWith('ja', { sourceHash: 'h2', messages: ready.messages });
  });

  it('applies the cached bundle first, and tells the server which version it has', async () => {
    const d = deps({
      readCache: vi.fn(() => Promise.resolve({ sourceHash: 'h1', messages: { 'nav.map': 'old' } })),
    });
    await loadBundle('ja', d);
    expect(d.apply.mock.calls.map((call) => call[1])).toEqual([
      { 'nav.map': 'old' },
      ready.messages,
    ]);
    expect(d.fetchBundle).toHaveBeenCalledWith('ja', 'h1');
  });

  it('does not apply PENDING English, waits retryAfterMs, then applies READY', async () => {
    const d = deps({
      fetchBundle: vi
        .fn<BundleLoaderDeps['fetchBundle']>()
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(ready),
    });
    expect(await loadBundle('ja', d)).toBe('ready');
    expect(d.wait).toHaveBeenCalledWith(2_000);
    expect(d.apply).toHaveBeenCalledTimes(1);
    expect(d.apply).toHaveBeenCalledWith('ja', ready.messages);
  });

  it('gives up after a bounded number of PENDING answers', async () => {
    const d = deps({ fetchBundle: vi.fn(() => Promise.resolve(pending)) });
    expect(await loadBundle('ja', d)).toBe('pending');
    expect(d.fetchBundle).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(d.writeCache).not.toHaveBeenCalled();
  });

  it('keeps the cache when offline', async () => {
    const d = deps({
      readCache: vi.fn(() => Promise.resolve({ sourceHash: 'h1', messages: { 'nav.map': 'old' } })),
      fetchBundle: vi.fn(() => Promise.reject(new Error('offline'))),
    });
    expect(await loadBundle('ja', d)).toBe('offline');
    expect(d.apply).toHaveBeenCalledTimes(1);
  });

  it('stops asking once the language is no longer the one on screen', async () => {
    const d = deps({ isCurrent: () => false });
    expect(await loadBundle('ja', d)).toBe('pending');
    expect(d.fetchBundle).not.toHaveBeenCalled();
  });
});
