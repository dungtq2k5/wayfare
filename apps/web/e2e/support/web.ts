import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { WEB } from './stack';

/** No `serious` or `critical` axe violation on the page as it is now. */
export async function expectAccessible(page: Page, disabled: string[] = []): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  const { violations } = await new AxeBuilder({ page }).disableRules(disabled).analyze();
  expect(
    violations
      .filter(({ impact }) => impact === 'serious' || impact === 'critical')
      .map(({ id, nodes }) => `${id}: ${nodes.map((node) => node.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}

/** No sideways scroll at the page's width (edge 9). */
export async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const { scroll, width } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: window.innerWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(width);
}

/** The page's language chosen on this browser (K7). */
export async function chooseLanguage(context: BrowserContext, lang: string): Promise<void> {
  await context.addCookies([{ name: 'wf_web_lang', value: lang, url: WEB }]);
}

let made = 0;
/** A unique address for a run. */
export const fresh = (label: string) =>
  `${label}-${Date.now().toString(36)}-${(made += 1)}@example.com`;
