import { describe, expect, it } from 'vitest';
import { appIntent, isAndroid, isIosSafari } from './intent';

describe('Open in the app (K10)', () => {
  it('opens the Place in the app, and the Play Store when it is not installed', () => {
    const link = appIntent('Z63T-CMMT');
    expect(
      link.startsWith('intent://wayfare.app/p/Z63T-CMMT#Intent;scheme=https;package=app.wayfare;'),
    ).toBe(true);
    expect(link).toContain(
      `S.browser_fallback_url=${encodeURIComponent('https://play.google.com/store/apps/details?id=app.wayfare')};end`,
    );
  });

  it("tells Android from an iPhone's Safari", () => {
    expect(isAndroid('Mozilla/5.0 (Linux; Android 14; Pixel 7)')).toBe(true);
    expect(isAndroid('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe(false);
    expect(isIosSafari('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Safari')).toBe(true);
    expect(isIosSafari('Mozilla/5.0 (iPhone) CriOS/120')).toBe(false);
  });
});
