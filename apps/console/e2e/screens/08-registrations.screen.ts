// The registrations (round 34's R1–R4b): the queue, an application, the reveal and what it shows,
// a redacted one, the approve dialog, and one's own application.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { apply } from '../support/people';
import { identitySql, resetRateLimits } from '../support/stack';
import type { Actor } from '../support/stack';
import { actor } from './content';
import { look } from './look';
import { as } from './people';
import { PEOPLE } from './setup';

test.beforeEach(() => resetRateLimits());

/** The application whose business is `name`, in any status (the queue lists pending ones by
 * default); its id. */
async function application(admin: Actor, name: string): Promise<string | null> {
  for (const status of ['PENDING', 'REJECTED', 'APPROVED']) {
    const { data } = await admin.call<{ data: { id: string; businessName: string }[] }>(
      'GET',
      `/admin/owner-registrations?q=${encodeURIComponent(name)}&status=${status}&pageSize=50`,
    );
    const found = data.find((row) => row.businessName === name);
    if (found !== undefined) return found.id;
  }
  return null;
}

async function open(page: Page, id: string, email: string = PEOPLE.lan): Promise<void> {
  await as(page, email);
  await page.goto(`/registrations/${id}`);
  await page.waitForLoadState('networkidle');
}

test('R1 the queue', async ({ page }) => {
  await as(page, PEOPLE.lan);
  await page.goto('/registrations');
  await expect(page.getByRole('link', { name: 'Ốc Vũ' })).toBeVisible();
  await look(page, 'r1-queue', { extra: ['720', '360'] });
});

test('R2 an application, R3 reveal, R3b revealed, R4 approve', async ({ page }) => {
  const id = (await application(await actor(PEOPLE.lan), 'Ốc Vũ'))!;
  await open(page, id);
  await expect(page.getByText('•••• 1234')).toBeVisible();
  await look(page, 'r2-application');
  await page.getByRole('button', { name: 'Reveal…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reveal the full national ID?' });
  await dialog
    .getByLabel('Why you need it')
    .fill('Checking it against the registration certificate');
  await look(page, 'r3-reveal', { viewportOnly: true });
  await dialog.getByRole('button', { name: 'Reveal', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hide' })).toBeVisible();
  await look(page, 'r3b-revealed');
  await page.getByRole('button', { name: 'Hide' }).click();
  await page.getByRole('button', { name: 'Approve…' }).click();
  await expect(page.getByRole('dialog', { name: 'Approve Ốc Vũ?' })).toBeVisible();
  await look(page, 'r4-approve', { viewportOnly: true });
});

test('R3c redacted', async ({ page }) => {
  // C10c's applicant, rejected there: redacted as the 180-day job would.
  const id = (await application(await actor(PEOPLE.lan), 'Bún Vy'))!;
  identitySql(
    `UPDATE owner_registrations SET national_id_ciphertext = NULL, national_id_last4 = NULL, pii_redacted_at = now() WHERE id = '${id}'`,
  );
  await open(page, id);
  await expect(page.getByText(/^Redacted on .*, 180 days after the decision\.$/)).toBeVisible();
  await look(page, 'r3c-redacted');
});

test('R4b your own application', async ({ page }) => {
  const quang = await actor(PEOPLE.quang);
  const id = (await application(quang, 'Phở Quang')) ?? (await apply(quang, 'Phở Quang'));
  await open(page, id, PEOPLE.quang);
  await expect(page.getByText('Your own application')).toBeVisible();
  await look(page, 'r4b-own-application');
});
