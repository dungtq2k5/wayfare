/** How long *Not now* rests the Android app sheet (K13). */
export const ANDROID_REST_MS = 30 * 86_400_000;

/**
 * The Android app sheet (WO1, K13): from a visit's second page view, never over a sticker's page
 * before its story has played, and not for 30 days after *Not now*.
 */
export function offerAndroidApp(input: {
  android: boolean;
  pageViews: number;
  onPlacePage: boolean;
  storyPlayed: boolean;
  restUntil: number;
  now: number;
}): boolean {
  if (!input.android || input.pageViews < 2) return false;
  if (input.onPlacePage && !input.storyPlayed) return false;
  return input.now >= input.restUntil;
}

/** *Add to Home Screen* (WO1b, K13): once ever, in iPhone Safari, not when already installed. */
export function offerHomeScreen(input: {
  iosSafari: boolean;
  standalone: boolean;
  shownBefore: boolean;
}): boolean {
  return input.iosSafari && !input.standalone && !input.shownBefore;
}
