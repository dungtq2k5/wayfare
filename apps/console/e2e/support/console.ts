// What every flow does in the browser: sign in, check a page with axe, and the language checks.
import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import en from '@wayfare/i18n/locales/en/console.json';
import vi from '@wayfare/i18n/locales/vi/console.json';

/** Signs in through C1 and waits for the shell. */
export async function signIn(
  page: Page,
  email: string,
  password: string,
  path = '/sign-in',
): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel(/^(Password|Mật khẩu)$/).fill(password);
  await page.getByRole('button', { name: /^(Sign in|Đăng nhập)$/ }).click();
  await expect(page.getByRole('button', { name: /^(Account menu|Menu tài khoản):/ })).toBeVisible();
}

/** No axe violation on the page as it stands (K20). */
export async function expectAccessible(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(
    violations.map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
    ),
  ).toEqual([]);
}

/**
 * The console in Vietnamese leaves no English string (edge 7): no English sentence whose
 * Vietnamese differs shows on the page.
 */
export async function expectNoEnglish(page: Page): Promise<void> {
  const text = await page.locator('body').innerText();
  const english = Object.entries(en as Record<string, string>)
    .filter(
      ([key, value]) =>
        value.length >= 8 && !/[{}]/.test(value) && (vi as Record<string, string>)[key] !== value,
    )
    .map(([, value]) => value)
    .filter((value) => text.includes(value));
  expect(english).toEqual([]);
}

/** Nothing wider than the window (edge 6): a table never scrolls sideways. */
export async function expectNoSidewaysScroll(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}
