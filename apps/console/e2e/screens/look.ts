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
 * pace), the QR sticker's image, the nav's waiting counts and the bell's count, and a Stripe event's
 * payload (its ids and times are the run's). A spec adds its own.
 */
const VARIABLE = ['.maplibregl-canvas', 'img[alt^="QR sticker"]', '[data-count]', '[data-payload]'];

/**
 * What varies, masked. Under an open dialog's overlay only the dialog's own: a mask is painted on
 * top of everything, so the page's behind it are hidden instead, a map painted in the mask's colour
 * under the scrim (magenta, Playwright's mask), as an open page masks it (`UNDER_OVERLAY`).
 */
async function variable(page: Page): Promise<Locator[]> {
  const modal = await covered(page);
  return VARIABLE.map((selector) => page.locator(modal ? `[role="dialog"] ${selector}` : selector));
}

/** Whether a dialog's overlay covers the page. */
const covered = async (page: Page): Promise<boolean> =>
  (await page.locator('[data-overlay][data-state="open"]').count()) > 0;

const UNDER_OVERLAY = `${VARIABLE.map((selector) => `${selector}:not([role="dialog"] *)`).join(', ')} { visibility: hidden !important; }
.maplibregl-map:not([role="dialog"] *)::after { content: ""; position: absolute; inset: 0; background: magenta; }`;

/**
 * Draws a state a spec has driven the page into, then checks it, in place: the page is resized and
 * re-themed, so every variant is the same state.
 *
 * - **Baselines**, with the clock stopped: at 1440 in light and dark, named
 *   `<frame>-1440-<scheme>.png`; at 720 and 360 in light only, and only where `extra` says a frame
 *   exists — the narrow frames are drawn in light.
 * - **Checks**, with time running, in light and dark at every width: axe (no `serious` or
 *   `critical` violation) and no sideways scroll. `disabled` names the rules a spec turns off, each
 *   with its reason beside the call; nothing is disabled globally.
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
    /** With `viewportOnly`: the window where the spec left it, not the page's top (an open menu). */
    keepScroll?: boolean;
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
  // A toast stays while the pointer is on it, through the checks after the captures, which run
  // with time going (a spec acts on it next, its Undo). A spec already holding one keeps its own:
  // moving to another would let go.
  const held = (await page.locator('[data-sonner-toast]:hover').count()) > 0;
  const toast = page.locator('[data-sonner-toast]').first();
  if (!held && (await toast.isVisible())) await toast.hover();
  const initial = page.viewportSize();
  const widths = (Object.keys(WIDTHS) as Width[]).filter(
    (width) => options.only === undefined || options.only.includes(width),
  );
  const narrow: Width[] = [...(options.extra ?? []), ...(options.only ?? [])];
  const variants = SCHEMES.flatMap((scheme) => widths.map((width) => ({ scheme, width })));

  // The baselines first, with time stopped (the screens fixture's clock): no timer fires between
  // them — a toast's seconds, a poll, a relative time — so every capture draws the same moment.
  // A second ahead: the clock can't pause in its past, and it moves while this call travels.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
  for (const { scheme, width } of variants) {
    if (width !== '1440' && !(scheme === 'light' && narrow.includes(width))) continue;
    await settle(page, name, scheme, width, true);
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
    if (options.keepScroll !== true) await page.evaluate(() => window.scrollTo(0, 0));
    const file = `${name}-${width}-${scheme}.png`;
    const mask = [...(await variable(page)), ...(options.mask ?? [])];
    const under = await covered(page);
    // A whole page draws the save bar where it ends, under the content, as the frames do; a
    // sticky bar would be caught wherever the window happened to end, under a map's mask.
    const whole = options.viewportOnly !== true;
    // A waiting count's box is one width however many digits the run left it with (it is masked).
    const style = `[data-count] { display: inline-block !important; width: 1.75rem !important; }${whole ? '[data-save-bar] { position: static !important; }' : ''}${under ? UNDER_OVERLAY : ''}`;
    // The rules are added around the capture, and taken away after it.
    const rules = await page.addStyleTag({ content: style });
    await (options.target === undefined
      ? expect(page).toHaveScreenshot(file, { mask, fullPage: whole })
      : expect(options.target).toHaveScreenshot(file, { mask }));
    await rules.evaluate((node) => (node as Element).remove());
  }
  await page.evaluate(stopNormalizing);
  // The checks with time running: axe works on the page's timers, which a stopped clock never fires.
  await page.clock.resume();
  for (const { scheme, width } of variants) {
    await settle(page, name, scheme, width);
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
    // Every text field shows an example of what goes in it (conventions §12.5); a password and a
    // typed confirmation say they have none (`data-no-example`).
    const bare = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')]
        .filter(
          (field) =>
            !['checkbox', 'radio', 'range', 'hidden', 'file', 'password'].includes(field.type) &&
            !field.hasAttribute('data-no-example') &&
            field.getAttribute('aria-hidden') !== 'true' &&
            field.getClientRects().length > 0 &&
            (field.placeholder ?? '').trim() === '',
        )
        .map((field) => field.labels?.[0]?.textContent?.trim() || field.name || field.id),
    );
    expect(bare, `${name}: text fields without a placeholder`).toEqual([]);
  }
  if (options.only === undefined) await noControlCutOff(page, name);
  await page.emulateMedia({ colorScheme: 'light' });
  if (initial !== null) await page.setViewportSize(initial);
}

/**
 * The laptop widths between the frames' — 1280 and 1024, where the sidebar leaves the least room —
 * checked for one thing only: no control cut off by a box it can't be scrolled into (a list's last
 * column, its *Publish*). Clipping doesn't depend on the scheme, so in light alone; no capture.
 * Not for a state that exists only at some widths.
 */
export async function noControlCutOff(page: Page, name: string): Promise<void> {
  await page.emulateMedia({ colorScheme: 'light' });
  for (const width of [1280, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForFunction(() =>
      document.getAnimations().every((animation) => animation.playState !== 'running'),
    );
    expect(await page.evaluate(cutOff), `${name} at ${width}: controls cut off`).toEqual([]);
  }
}

/**
 * The visible controls whose box extends past an ancestor that clips (`overflow: hidden` or
 * `clip`) with no scroll container between them. Not counted: a control smaller than 1 × 1 or
 * inside a box that is (visually hidden), text cut with an ellipsis, and a deliberate case marked
 * `data-clip-ok` (its reason beside it).
 */
function cutOff(): string[] {
  const clips = (value: string) => value === 'hidden' || value === 'clip';
  const scrolls = (value: string) => value === 'auto' || value === 'scroll';
  const found: string[] = [];
  const controls = document.querySelectorAll<HTMLElement>(
    'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"]',
  );
  for (const control of controls) {
    if (control.closest('[data-clip-ok]') !== null) continue;
    const box = control.getBoundingClientRect();
    if (box.width <= 1 || box.height <= 1 || getComputedStyle(control).visibility === 'hidden') {
      continue;
    }
    for (let parent = control.parentElement; parent !== null; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (scrolls(style.overflowX) || scrolls(style.overflowY)) break;
      const outer = parent.getBoundingClientRect();
      if (outer.width <= 1 || outer.height <= 1 || style.textOverflow === 'ellipsis') break;
      const sideways =
        clips(style.overflowX) && (box.left < outer.left - 1 || box.right > outer.right + 1);
      const down =
        clips(style.overflowY) && (box.top < outer.top - 1 || box.bottom > outer.bottom + 1);
      if (sideways || down) {
        const label = (control.getAttribute('aria-label') ?? control.textContent ?? '').trim();
        found.push(`${control.tagName.toLowerCase()} "${label.slice(0, 40)}"`);
        break;
      }
    }
  }
  return found;
}

/** The page at one scheme and width, its fonts loaded and its animations ended. */
async function settle(
  page: Page,
  name: string,
  scheme: (typeof SCHEMES)[number],
  width: Width,
  paused = false,
): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize(WIDTHS[width]);
  // With the clock stopped, a quarter second runs once the page's animations end: what a resize
  // or a closed dialog starts on the page's timers lands (a map fitting its new width, focus
  // returned to its button after the dialog's exit), and a toast's seconds barely move.
  if (paused) {
    await animationsEnded(page);
    await page.clock.runFor(250);
  }
  await page.evaluate(() => document.fonts.ready);
  // A font stack whose variable is undefined is void, and the page falls to the system font:
  // a capture then, or a baseline written from it, compares every frame against the wrong
  // letters. The body's first family is the brand's, as its variable names it.
  expect(
    await page.evaluate(() => {
      const unquote = (family: string) => family.trim().replace(/^["']|["']$/g, '');
      const brand = getComputedStyle(document.documentElement)
        .getPropertyValue('--font-be-vietnam-pro')
        .split(',')[0]!;
      const first = getComputedStyle(document.body).fontFamily.split(',')[0]!;
      return unquote(brand) !== '' && unquote(first) === unquote(brand);
    }),
    `${name}: the page is not in its own font`,
  ).toBe(true);
  // A drawer or a dialog still opening would be checked and drawn half-faded.
  await animationsEnded(page);
}

const animationsEnded = (page: Page) =>
  page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== 'running'),
  );

/** No `serious` or `critical` axe violation on the page as it is now. */
export async function accessible(page: Page, disabled: string[] = []): Promise<void> {
  // A sheet or dialog still fading in would be measured half-transparent: wait for its finite
  // animations to end (a spinner's infinite one never does, so it is left alone).
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== 'running' ||
          animation.effect?.getComputedTiming().iterations === Infinity,
      ),
  );
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

/** Starts tabbing from a page's heading: `tabsThrough` then checks the stops after it. */
export async function from(page: Page, level: 1 | 2 = 1): Promise<void> {
  await page
    .getByRole('main')
    .getByRole('heading', { level })
    .first()
    .evaluate((heading: HTMLElement) => {
      heading.tabIndex = -1;
      heading.focus();
    });
}
