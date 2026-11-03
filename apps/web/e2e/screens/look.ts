import { join } from 'node:path';
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { accessible } from '../../../console/e2e/screens/look';
import { keepNormalized, RULES, stopNormalizing } from '../../../console/e2e/screens/normalize';
import type { Rule } from '../../../console/e2e/screens/normalize';

/** The handoff's widths (§1): the phone, 720 px and 1440 px. */
const WIDTHS = {
  '360': { width: 360, height: 800 },
  '720': { width: 720, height: 900 },
  '1440': { width: 1440, height: 900 },
} as const;
export type Width = keyof typeof WIDTHS;
const SCHEMES = ['light', 'dark'] as const;

/**
 * The web's own rules, before the console's: a story's elapsed time (it runs while the page is
 * drawn) and the week's today, which is the run's weekday.
 */
const WEB_RULES: readonly Rule[] = [
  ['\\b\\d+:\\d{2} / ', 'g', '0:04 / '],
  ['^(Playing|Paused|Tap play to hear it)( \\([^)]*\\))? · \\d+:\\d{2}', 'g', '$1$2 · 0:04'],
];

/**
 * What varies and is covered by a solid box: the week of opening hours (today is the run's day),
 * the players' progress lines, scrubber and elapsed time (the story runs as it is drawn).
 */
const VARIABLE = ['[data-week]', '[data-progress]', '[data-elapsed]'];

/**
 * The console's rules, less its lone clock time: the web's lone times are a story's length, the
 * same on every run (its elapsed time beside it is masked).
 */
const CONSOLE_RULES = RULES.filter(([source]) => source !== '^\\d{1,2}:\\d{2}$');

/** The maps' canvases hidden for each capture (the stylesheet says why). */
const HIDDEN = join(__dirname, 'hide-maps.css');

/** Whether a dialog's overlay covers the page. */
const covered = async (page: Page): Promise<boolean> =>
  (await page.locator('[data-state="open"][role="dialog"]').count()) > 0;

/**
 * Checks a state a spec has driven the page into, then draws it, in place (the handoff's §1):
 *
 * - **Checks**, in light and dark at 360, 720 and 1440: axe (no `serious` or `critical`
 *   violation), no sideways scroll, and every text field with its placeholder.
 * - **Baselines**: at 360 in light and dark, named `<frame>-360-<scheme>.png`; at 720 and 1440 in
 *   light, only where `extra` says the frame exists (the ★ states).
 */
export async function look(
  page: Page,
  name: string,
  options: {
    extra?: ('720' | '1440')[];
    /** A state that exists at these widths only. */
    only?: Width[];
    mask?: Locator[];
    disabled?: string[];
    /** The viewport rather than the whole page: a sheet, a dialog, a player fixed to it. */
    viewportOnly?: boolean;
  } = {},
): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  const initial = page.viewportSize();
  const widths = (Object.keys(WIDTHS) as Width[]).filter(
    (width) => options.only === undefined || options.only.includes(width),
  );
  for (const scheme of SCHEMES) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const width of widths) {
      await page.setViewportSize(WIDTHS[width]);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() =>
        document.getAnimations().every((animation) => animation.playState !== 'running'),
      );
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, `${name} at ${width} is wider than the viewport`).toBeLessThanOrEqual(
        WIDTHS[width].width,
      );
      await accessible(page, options.disabled);
      const bare = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLInputElement>('input, textarea')]
          .filter(
            (field) =>
              !['checkbox', 'radio', 'range', 'hidden', 'file', 'password'].includes(field.type) &&
              !field.hasAttribute('data-no-example') &&
              field.getClientRects().length > 0 &&
              (field.placeholder ?? '').trim() === '',
          )
          .map((field) => field.labels?.[0]?.textContent?.trim() || field.name || field.id),
      );
      expect(bare, `${name}: text fields without a placeholder`).toEqual([]);
      const drawn =
        width === '360' ||
        (scheme === 'light' && [...(options.extra ?? []), ...(options.only ?? [])].includes(width));
      if (!drawn) continue;
      await page.evaluate(keepNormalized, [...WEB_RULES, ...CONSOLE_RULES]);
      const whole = options.viewportOnly !== true && !(await covered(page));
      if (whole) await page.evaluate(() => window.scrollTo(0, 0));
      await expect(page).toHaveScreenshot(`${name}-${width}-${scheme}.png`, {
        mask: [...VARIABLE.map((selector) => page.locator(selector)), ...(options.mask ?? [])],
        fullPage: whole,
        stylePath: HIDDEN,
      });
    }
  }
  await page.evaluate(stopNormalizing);
  await page.emulateMedia({ colorScheme: 'light' });
  if (initial !== null) await page.setViewportSize(initial);
}

export { from, tabsThrough } from '../../../console/e2e/screens/look';
