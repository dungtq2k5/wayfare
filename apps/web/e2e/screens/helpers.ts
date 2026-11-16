import type { BrowserContext, Page } from '@playwright/test';
import { WEB } from '../support/stack';

/** The page's language on this browser (K7). */
export async function language(context: BrowserContext, lang: string): Promise<void> {
  await context.addCookies([{ name: 'wf_web_lang', value: lang, url: WEB }]);
}

/**
 * A story that keeps playing while the state is drawn at every width and scheme: the browser's
 * audio runs at a sixteenth of its speed, the slowest Chromium allows (the times are normalised, the progress lines masked).
 */
export async function slowAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      this.playbackRate = 0.0625;
      this.addEventListener('ratechange', () => {
        if (this.playbackRate > 0.0625) this.playbackRate = 0.0625;
      });
      return play.call(this);
    };
  });
}

/** WN4b: the browser holds the sound back until a tap — `play()` refuses once. */
export async function soundHeldBack(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    let refused = false;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (!refused) {
        refused = true;
        return Promise.reject(new DOMException('play() needs a gesture', 'NotAllowedError'));
      }
      return play.call(this);
    };
  });
}

/** A browser with a voice in `langs` (WN3c), or none (WN4); `speak` reads nothing aloud. */
export async function voices(page: Page, langs: string[]): Promise<void> {
  await page.addInitScript((list: string[]) => {
    const all = list.map((lang) => ({ lang, name: lang }) as SpeechSynthesisVoice);
    Object.defineProperty(window.speechSynthesis, 'getVoices', { value: () => all });
    Object.defineProperty(window.speechSynthesis, 'speak', { value: () => undefined });
  }, langs);
}

/** A Place's own read with its audio taken out, as a story not made yet (K14). */
export async function withoutAudio(page: Page, placeId: string): Promise<void> {
  await page.route(`**/api/v1/places/${placeId}?lang=*`, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { data: { localization: { audio: unknown } } };
    body.data.localization.audio = null;
    await route.fulfill({ response, json: body });
  });
}

/** WN3: a job that never finishes while the state is drawn. */
export async function preparingForever(page: Page, placeId: string): Promise<void> {
  await page.route('**/api/v1/narration/on-demand', (route) =>
    route.fulfill({
      status: 202,
      json: { data: { status: 'PENDING', jobId: placeId, retryAfterMs: 60_000 } },
    }),
  );
}
