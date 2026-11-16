import { describe, expect, it } from 'vitest';
import { ANDROID_REST_MS, offerAndroidApp, offerHomeScreen } from './rules';

const base = {
  android: true,
  pageViews: 2,
  onPlacePage: false,
  storyPlayed: false,
  restUntil: 0,
  now: 1_000,
};

describe('the prompts (K13)', () => {
  it("offers the Android app from a visit's second page", () => {
    expect(offerAndroidApp({ ...base, pageViews: 1 })).toBe(false);
    expect(offerAndroidApp(base)).toBe(true);
    expect(offerAndroidApp({ ...base, android: false })).toBe(false);
  });

  it("never over a sticker's page before its story has played", () => {
    expect(offerAndroidApp({ ...base, onPlacePage: true })).toBe(false);
    expect(offerAndroidApp({ ...base, onPlacePage: true, storyPlayed: true })).toBe(true);
  });

  it('rests 30 days after Not now', () => {
    const restUntil = base.now + ANDROID_REST_MS;
    expect(offerAndroidApp({ ...base, restUntil })).toBe(false);
    expect(offerAndroidApp({ ...base, restUntil, now: restUntil })).toBe(true);
  });

  it('offers the Home Screen once ever, in iPhone Safari, when not installed', () => {
    expect(offerHomeScreen({ iosSafari: true, standalone: false, shownBefore: false })).toBe(true);
    expect(offerHomeScreen({ iosSafari: true, standalone: false, shownBefore: true })).toBe(false);
    expect(offerHomeScreen({ iosSafari: true, standalone: true, shownBefore: false })).toBe(false);
    expect(offerHomeScreen({ iosSafari: false, standalone: false, shownBefore: false })).toBe(
      false,
    );
  });
});
