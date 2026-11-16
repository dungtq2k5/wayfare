// Every spec's `test` and `expect`: Playwright's, with one automatic fixture that fails a test on
// any Content Security Policy violation the page reports (architecture §10) — a page must run under
// its policy, so a new origin goes into the app's env and policy function, never into an exception
// here. Violations inside workers don't reach the page; the manual checks cover those.
import { expect, test as base } from '@playwright/test';

export { expect };

export const test = base.extend<{ contentSecurityPolicy: void }>({
  contentSecurityPolicy: [
    async ({ page }, use) => {
      const violations: string[] = [];
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
          console.error(
            `CSP violation: ${event.effectiveDirective} blocked ${event.blockedURI || 'inline'}`,
          );
        });
      });
      page.on('console', (message) => {
        if (
          message.type() === 'error' &&
          /Content Security Policy|CSP violation/.test(message.text())
        )
          violations.push(message.text());
      });
      await use();
      expect(violations, 'Content Security Policy violations').toEqual([]);
    },
    { auto: true },
  ],
});
