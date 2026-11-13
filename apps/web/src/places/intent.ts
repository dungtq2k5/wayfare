import { PLAY_STORE_URL } from '../env';

/**
 * *Open in the app* on Android (K10): an intent link that opens the app when installed and the Play
 * Store when not — Wayfare's App Links don't verify yet, so the page's own URL would only reopen
 * the browser.
 */
export function appIntent(code: string, host = 'wayfare.app'): string {
  return `intent://${host}/p/${encodeURIComponent(code)}#Intent;scheme=https;package=app.wayfare;S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};end`;
}

/** Whether a user agent is Android's (the app bar and WO1 are Android's only). */
export const isAndroid = (userAgent: string | null): boolean => /Android/i.test(userAgent ?? '');

/** Whether a user agent is an iPhone's or iPad's Safari (WO1b's Home Screen steps). */
export const isIosSafari = (userAgent: string | null): boolean =>
  /iP(hone|ad|od)/.test(userAgent ?? '') && !/CriOS|FxiOS|EdgiOS/.test(userAgent ?? '');
