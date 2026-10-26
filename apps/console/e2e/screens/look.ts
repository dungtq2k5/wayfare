import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { keepNormalized, RULES, stopNormalizing } from './normalize';

/** The frames' widths: the desktop frame, 200 % zoom (720 CSS px) and the phone. */
const WIDTHS = {
  '1440': { width: 1440, height: 900 },
  '720': { width: 720, height: 900 },
  '360': { width: 360, height: 800 },
} as const;
export type Width = keyof typeof WIDTHS;
const SCHEMES = ['light', 'dark'] as const;

/**
 * What still varies and is covered by a solid box (Playwright's mask), so the box keeps its size and
 * nothing beside it moves: the maps' canvases (WebGL draws by machine, tiles arrive at their own
 * pace), the QR sticker's image, the nav's waiting counts and the bell's count. A spec adds its own.
 */
const VARIABLE = ['.maplibregl-canvas', 'img[alt^="QR sticker"]', '[data-count]'];

/**
 * What varies, masked. Under an open dialog's overlay only the dialog's own: a mask is painted on
 * top of everything, so the page's behind it are hidden instead (`UNDER_OVERLAY`).
 */
async function variable(page: Page): Promise<Locator[]> {
  const modal = await covered(page);
  return VARIABLE.map((selector) => page.locator(modal ? `[role="dialog"] ${selector}` : selector));
}

/** Whether a dialog's overlay covers the page. */
const covered = async (page: Page): Promise<boolean> =>
  (await page.locator('[data-overlay][data-state="open"]').count()) > 0;

const UNDER_OVERLAY = `${VARIABLE.map((selector) => `${selector}:not([role="dialog"] *)`).join(', ')} { visibility: hidden !important; }`;

/**
 * Checks a state a spec has driven the page into, then draws it, in place: the page is resized and
 * re-themed, so every variant is the same state.
 *
 * - **Checks**, in light and dark at every width: axe (no `serious` or `critical` violation) and no
 *   sideways scroll. `disabled` names the rules a spec turns off, each with its reason beside the
 *   call; nothing is disabled globally.
 * - **Baselines**: at 1440 in light and dark, named `<frame>-1440-<scheme>.png`; at 720 and 360 in
 *   light only, and only where `extra` says a frame exists — the narrow frames are drawn in light.
 *
 * @example await look(page, 'c6-admin-shell', { extra: ['720', '360'] });
 */
export async function look(
  page: Page,
  name: string,
  options: {
    /** The narrow widths this state has a frame at (the ★ frames). */
    extra?: ('720' | '360')[];
    /** A state that exists at these widths only, such as the phone's drawer. */
    only?: Width[];
    mask?: Locator[];
    disabled?: string[];
    /** The viewport rather than the whole page: a toast or a panel fixed to it. */
    viewportOnly?: boolean;
    /** One region rather than the page: a pattern on the page that shows them all. */
    target?: Locator;
    /** The state is the API down (C16a): its banner is the point, not a request that failed. */
    apiDown?: boolean;
  } = {},
): Promise<void> {
  // Every read the state starts settled: the nav's counts arrive after the page. A state that
  // holds a call open (loading, in flight) never goes idle, so the wait has a ceiling.
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  // Next's development overlay (its issues badge) is the dev server's, not the console's.
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  // The API-down banner raised by a read that failed mid-capture (a loaded machine) is not the
  // state either; one present before a capture still fails it (the check below counts it hidden).
  if (options.apiDown !== true) {
    await page.addStyleTag({
      content: '[role="status"][data-tone="error"] { display: none !important; }',
    });
  }
  const initial = page.viewportSize();
  const widths = (Object.keys(WIDTHS) as Width[]).filter(
    (width) => options.only === undefined || options.only.includes(width),
  );
  for (const scheme of SCHEMES) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const width of widths) {
      await page.setViewportSize(WIDTHS[width]);
      await page.evaluate(() => document.fonts.ready);
      // A drawer or a dialog still opening would be checked and drawn half-faded.
      await page.waitForFunction(() =>
        document.getAnimations().every((animation) => animation.playState !== 'running'),
      );
      const { scrollWidth, widest } = await page.evaluate(() => {
        // Where the spill starts, to fix when the page scrolls: an element past the window inside
        // one that isn't.
        const past = (element: Element) =>
          element.getBoundingClientRect().right > window.innerWidth + 1;
        const innermost = [...document.body.querySelectorAll('*')].filter(
          (element) =>
            past(element) && element.parentElement !== null && !past(element.parentElement),
        );
        return {
          scrollWidth: document.documentElement.scrollWidth,
          widest: innermost
            .slice(0, 5)
            .map(
              (element) =>
                `${element.tagName.toLowerCase()}.${[...element.classList].slice(0, 4).join('.')} "${(element.textContent ?? '').trim().slice(0, 40)}"`,
            ),
        };
      });
      expect(
        scrollWidth,
        `${name} at ${width} is wider than the viewport: ${widest.join('; ')}`,
      ).toBeLessThanOrEqual(WIDTHS[width].width);
      await accessible(page, options.disabled);
      const narrow: Width[] = [...(options.extra ?? []), ...(options.only ?? [])];
      const drawn = width === '1440' || (scheme === 'light' && narrow.includes(width));
      if (!drawn) continue;
      // A request that failed on the way (a loaded machine) raises the API-down banner until the next
      // read succeeds; a baseline drawn with it would be a different state.
      if (options.apiDown !== true) {
        await expect(
          page.getByText("Wayfare can't reach its servers.", { exact: false }),
          `${name} shows the API-down banner: a request failed on the way`,
        ).toHaveCount(0);
      }
      await page.evaluate(keepNormalized, RULES);
      // From the top: a full-page capture draws the fixed sidebar wherever the scroll left it.
      await page.evaluate(() => window.scrollTo(0, 0));
      const file = `${name}-${width}-${scheme}.png`;
      const mask = [...(await variable(page)), ...(options.mask ?? [])];
      const under = await covered(page);
      // A whole page draws the save bar where it ends, under the content, as the frames do; a
      // sticky bar would be caught wherever the window happened to end, under a map's mask.
      const whole = options.viewportOnly !== true;
      const style = `${whole ? '[data-save-bar] { position: static !important; }' : ''}${under ? UNDER_OVERLAY : ''}`;
      // The rules are added around the capture, and taken away after it.
      const rules = style === '' ? null : await page.addStyleTag({ content: style });
      await (options.target === undefined
        ? expect(page).toHaveScreenshot(file, { mask, fullPage: whole })
        : expect(options.target).toHaveScreenshot(file, { mask }));
      await rules?.evaluate((node) => (node as Element).remove());
    }
  }
  await page.evaluate(stopNormalizing);
  await page.emulateMedia({ colorScheme: 'light' });
  if (initial !== null) await page.setViewportSize(initial);
}

/** No `serious` or `critical` axe violation on the page as it is now. */
export async function accessible(page: Page, disabled: string[] = []): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).disableRules(disabled).analyze();
  expect(
    violations
      .filter(({ impact }) => impact === 'serious' || impact === 'critical')
      .map(({ id, nodes }) => `${id}: ${nodes.map((node) => node.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}

/**
 * Tabs from where focus is, asserting each stop by its accessible name in order: a screen's focus
 * order, as its handoff's accessibility notes give it.
 */
export async function tabsThrough(page: Page, stops: RegExp[]): Promise<void> {
  for (const stop of stops) {
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveAccessibleName(stop);
  }
}
