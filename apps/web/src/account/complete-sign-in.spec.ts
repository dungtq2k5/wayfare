// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ favoritesList: vi.fn() }));
vi.mock('@wayfare/api-client', () => api);
const kv = vi.hoisted(() => ({ writeKv: vi.fn(() => Promise.resolve()) }));
vi.mock('../client/db', () => kv);

const { completeSignIn, countSavedHere, MERGE_NOTE_KEY, safeNext } =
  await import('./complete-sign-in');
const { readPageCookie } = await import('@wayfare/ui/cookies');

const saved = (n: number) => ({ data: Array.from({ length: n }, (_, i) => ({ id: `p${i}` })) });

describe('signing in on the web (K2, WA3c)', () => {
  const assign = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('location', { assign });
  });

  it('counts this browser’s saves, and none when they can’t be read', async () => {
    api.favoritesList.mockResolvedValueOnce(saved(3));
    expect(await countSavedHere('en')).toBe(3);
    expect(api.favoritesList).toHaveBeenCalledWith({ lang: 'en', limit: 100 });
    api.favoritesList.mockRejectedValueOnce(new Error('offline'));
    expect(await countSavedHere('en')).toBe(0);
  });

  it('returns only to a path on this site, never to another origin', () => {
    expect(safeNext('/p/BT1')).toBe('/p/BT1');
    expect(safeNext('//evil.test/x')).toBeNull();
    expect(safeNext('https://evil.test')).toBeNull();
    expect(safeNext(null)).toBeNull();
  });

  it('remembers the session, keeps the merge note when saves joined the account’s, and goes back', async () => {
    api.favoritesList.mockResolvedValueOnce(saved(5));
    await completeSignIn('/p/BT1', 2, 'en');
    expect(readPageCookie('wf_web_account')).toBe('1');
    expect(kv.writeKv).toHaveBeenCalledWith(MERGE_NOTE_KEY, JSON.stringify({ others: 3, here: 2 }));
    expect(assign).toHaveBeenCalledWith('/p/BT1');
  });

  it('keeps no note when nothing joined, and goes to the favourites with no safe path', async () => {
    api.favoritesList.mockResolvedValueOnce(saved(2));
    await completeSignIn('//evil.test', 2, 'en');
    api.favoritesList.mockResolvedValueOnce(saved(4));
    await completeSignIn(null, 0, 'en');
    expect(kv.writeKv).not.toHaveBeenCalled();
    expect(assign.mock.calls).toEqual([['/favourites'], ['/favourites']]);
  });
});
