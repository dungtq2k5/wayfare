// Becoming an owner, the application (round 36's N4–N8): Trần Bảo Ngọc applies, is refused on two
// fields, sends it and is approved onto Free; Hải's application waits (round 34's R1), Trang's was not
// approved, Tuấn withdrew his. The admin's decisions through round 34's routes.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { signIn } from '../support/console';
import { PASSWORD } from '../support/people';
import { resetRateLimits } from '../support/stack';
import { actor } from './content';
import { from, look, tabsThrough } from './look';
import { applicationOf, OWNERS, person } from './owners';
import { as } from './people';
import { PEOPLE } from './setup';

test.beforeEach(() => resetRateLimits());

/** Ngọc's answers, as N4 draws them. */
async function answers(page: Page, nationalId: string): Promise<void> {
  await page.getByLabel('Business name').fill('Ốc Ngọc Vĩnh Khánh');
  await page.getByLabel('Business address').fill('212 Vĩnh Khánh, Phường 10, Quận 4');
  await page.getByLabel('Contact name').fill('Trần Bảo Ngọc');
  await page.getByLabel('Contact phone').fill('090 812 3456');
  await page.getByLabel('National ID number (CCCD)').fill(nationalId);
  await page.getByLabel('Note').fill('Chúng tôi bán ở đây từ năm 2015; bảng hiệu ghi "Ốc Ngọc".');
}

test('N4 apply, N4b refused, then sent (N5 is Hải’s)', async ({ page }) => {
  const ngoc = await person(OWNERS.ngoc, 'Trần Bảo Ngọc');
  const { data: mine } = await ngoc.call<{ data: unknown[] }>('GET', '/owner/registration');
  test.skip(mine.length > 0, 'Ngọc applied on an earlier run: N4 needs a fresh stack');
  await signIn(page, OWNERS.ngoc, PASSWORD);
  await page.goto('/owner/registration/apply');
  await page.waitForLoadState('networkidle');
  await answers(page, '');
  await look(page, 'n4-apply', { extra: ['720', '360'] });
  await from(page);
  await tabsThrough(page, [
    /^Business name/,
    /^Business address/,
    /^Business registration number/,
    /^Contact name/,
    /^Contact phone/,
    /^National ID number/,
    /^Note/,
    /^Read the whole agreement$/,
    /^I have read the owner agreement/,
    /^Send application$/,
  ]);
  // N4b's case: the agreement changed while she filled the form in (the version the form sends is
  // one the API no longer takes), then an ID one digit short.
  const route = '**/api/v1/owner/registration';
  await page.route(route, async (sent) => {
    const body = sent.request().postDataJSON() as Record<string, unknown>;
    await sent.continue({
      postData: JSON.stringify({ ...body, ownerAgreementVersion: '2020-01-01' }),
    });
  });
  await page.getByLabel('National ID number (CCCD)').fill('079201000123');
  await page.getByRole('checkbox', { name: /^I have read the owner agreement/ }).check();
  await page.getByRole('button', { name: 'Send application' }).click();
  await expect(page.getByText('The owner agreement has a new version')).toBeVisible();
  await page.unroute(route);
  await page.getByLabel('National ID number (CCCD)').fill('07920100012');
  await page.getByRole('button', { name: 'Send application' }).click();
  await expect(page.getByText('A national ID has 12 digits; this has 11.')).toBeVisible();
  await expect(page.getByText('The owner agreement has a new version')).toBeVisible();
  await expect(page.getByText('2 things need attention')).toBeVisible();
  await look(page, 'n4b-apply-refused');
  await page.getByLabel('National ID number (CCCD)').fill('079201000123');
  await page.getByRole('checkbox', { name: /^I have read the owner agreement/ }).check();
  await page.getByRole('button', { name: 'Send application' }).click();
  await expect(page.getByText('Waiting for review').first()).toBeVisible();
});

test('N5 waiting, N5b withdraw', async ({ page }) => {
  await as(page, PEOPLE.hai);
  await page.goto('/owner/registration');
  await expect(page.getByText('•••• 1234')).toBeVisible();
  await look(page, 'n5-waiting');
  await from(page);
  await tabsThrough(page, [/^Withdraw…$/]);
  await page.getByRole('button', { name: 'Withdraw…' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await look(page, 'n5b-withdraw', { viewportOnly: true });
});

test('N6 not approved, N6b apply again', async ({ page }) => {
  const trang = await person(OWNERS.trang, 'Phạm Thu Trang');
  const application = await applicationOf(trang, 'Bánh mì Trang');
  if (application.status === 'PENDING') {
    const lan = await actor(PEOPLE.lan);
    await lan.call('POST', `/admin/owner-registrations/${application.id}/reject`, {
      decisionNote: 'Please add a photo of your business registration certificate to the note.',
    });
  }
  await as(page, OWNERS.trang);
  await page.goto('/owner/registration');
  await expect(page.getByText('Note from Wayfare')).toBeVisible();
  await look(page, 'n6-rejected');
  await page.getByRole('link', { name: 'Apply again' }).click();
  await expect(page.getByLabel('Business name')).toHaveValue('Bánh mì Trang');
  await expect(page.getByLabel('National ID number (CCCD)')).toHaveValue('');
  await look(page, 'n6b-apply-again');
});

test('N7 withdrawn', async ({ page }) => {
  const tuan = await person(OWNERS.tuan, 'Đỗ Minh Tuấn');
  const application = await applicationOf(tuan, 'Hủ tiếu Tuấn');
  if (application.status === 'PENDING')
    await tuan.call('POST', `/owner/registration/${application.id}/withdraw`);
  await as(page, OWNERS.tuan);
  await page.goto('/owner/registration');
  await expect(page.getByText('You withdrew this application')).toBeVisible();
  await look(page, 'n7-withdrawn');
});

test('N8 approved: the first visit', async ({ page }) => {
  const ngoc = await actor(OWNERS.ngoc);
  const { data } = await ngoc.call<{ data: { id: string; status: string }[] }>(
    'GET',
    '/owner/registration',
  );
  if (data[0]?.status === 'PENDING') {
    const lan = await actor(PEOPLE.lan);
    await lan.call('POST', `/admin/owner-registrations/${data[0].id}/approve`, {
      decisionNote: 'Welcome to Wayfare.',
    });
  }
  // The plan reaches billing from the approval's event a moment later.
  await expect(async () => {
    await (await actor(OWNERS.ngoc)).call('GET', '/owner/places/limits');
  }).toPass({ timeout: 60_000 });
  await as(page, OWNERS.ngoc);
  await expect(page.getByRole('heading', { name: 'Welcome to Wayfare', level: 1 })).toBeVisible();
  await look(page, 'n8-approved');
});
