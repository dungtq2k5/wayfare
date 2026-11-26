import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fakeGoogleKeys, publishedGoogleKeys } from './google-keys';
import { FAKE_GOOGLE_KEY_ID } from './id-token';

const jwk = {
  ...generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'jwk' }),
  kid: 'k1',
};

/** A `fetch` answering Google's keys, counting its calls; `down` makes it fail. */
function google(maxAge = 600) {
  const state = { calls: 0, down: false };
  const fetchKeys = (() => {
    state.calls += 1;
    if (state.down) return Promise.reject(new Error('offline'));
    return Promise.resolve(
      new Response(JSON.stringify({ keys: [jwk] }), {
        headers: { 'cache-control': `public, max-age=${maxAge}` },
      }),
    );
  }) as typeof fetch;
  return { state, fetchKeys };
}

describe('Google’s published keys', () => {
  it('are fetched once and kept as long as Cache-Control says', async () => {
    let now = 0;
    const { state, fetchKeys } = google();
    const keys = publishedGoogleKeys(fetchKeys, () => now);
    expect(await keys.key('k1')).toBeDefined();
    expect(await keys.key('k1')).toBeDefined();
    expect(state.calls).toBe(1);
    now = 601_000;
    await keys.key('k1');
    expect(state.calls).toBe(2);
  });

  it('refetch for an unknown key at most once a minute, and say when Google cannot be asked', async () => {
    let now = 0;
    const { state, fetchKeys } = google();
    const keys = publishedGoogleKeys(fetchKeys, () => now);
    expect(await keys.key('unknown')).toBeUndefined();
    expect(await keys.key('unknown')).toBeUndefined();
    expect(state.calls).toBe(1);
    now = 61_000;
    await keys.key('unknown');
    expect(state.calls).toBe(2);
    // Fresh keys survive a failed refetch; with none fresh, Google is unavailable.
    state.down = true;
    now = 130_000;
    expect(await keys.key('k1')).toBeDefined();
    now = 700_000;
    expect(await keys.key('k1')).toBe('unavailable');
  });

  it('call an error answer unavailable, skip a key with no id, and keep an hour without max-age', async () => {
    let now = 0;
    let answer = new Response('', { status: 503 });
    const keys = publishedGoogleKeys(
      () => Promise.resolve(answer),
      () => now,
    );
    expect(await keys.key('k1')).toBe('unavailable');

    const { kid: _kid, ...nameless } = jwk;
    answer = new Response(JSON.stringify({ keys: [nameless, jwk] }));
    expect(await keys.key('k1')).toBeDefined();
    now = 3_599_000;
    answer = new Response('', { status: 503 });
    expect(await keys.key('k1')).toBeDefined();
    now = 3_600_000;
    expect(await keys.key('k1')).toBe('unavailable');

    answer = new Response(JSON.stringify({}));
    expect(await keys.key('k1')).toBeUndefined();
  });
});

describe('the fake issuer’s keys (development only)', () => {
  it('publish its one key and no other', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const keys = fakeGoogleKeys(privateKey);
    expect(await keys.key(FAKE_GOOGLE_KEY_ID)).toBeDefined();
    expect(await keys.key('k1')).toBeUndefined();
  });
});
