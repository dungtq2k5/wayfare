// The submissions (round 34's S1–S6): the queue, an update's diff, a conflict, the approve and
// reject dialogs, a creation, and one someone else decided first.
import { expect, test } from '../support/test';
import type { Page } from '@playwright/test';
import { resetRateLimits } from '../support/stack';
import type { Actor } from '../support/stack';
import { actor, OC_OANH, untilNarrationIdle, upload } from './content';
import { BINH_VENUE, freeOwner, liveVenue, OWNERS } from './owners';
import { look } from './look';
import { as } from './people';
import { PEOPLE } from './setup';

test.beforeEach(() => resetRateLimits());

interface Row {
  id: string;
  kind: string;
  payload: { nameVi: string };
}

async function pending(admin: Actor): Promise<Row[]> {
  return (await admin.call<{ data: Row[] }>('GET', '/admin/submissions?pageSize=50')).data;
}

/** Bình's live venue: his own, so the owner screens' Ốc Oanh is changed by nobody here. */
async function binhVenue(): Promise<{ binh: Actor; venue: string }> {
  const binh = await freeOwner(OWNERS.binh, 'Trần Văn Bình');
  return { binh, venue: await liveVenue(binh, BINH_VENUE) };
}

/**
 * The queue as the frames draw it: the seed's creation and update, Bình's update of Ốc Bình (S2;
 * an admin's change since comes with `conflict`, S3), and An's creation (S4b). Each made once.
 */
async function queue(): Promise<{ admin: Actor; rows: Row[] }> {
  const admin = await actor(PEOPLE.lan);
  const { binh, venue } = await binhVenue();
  let rows = await pending(admin);
  if (!rows.some((row) => row.payload.nameVi === BINH_VENUE.nameVi)) {
    const { data: detail } = await binh.call<{
      data: { editableHash: string; place: { photos: { id: string; altTextVi: string | null }[] } };
    }>('GET', `/owner/places/${venue}`);
    await binh.call('POST', '/owner/submissions', {
      kind: 'UPDATE',
      placeId: venue,
      baseEditableHash: detail.editableHash,
      payload: {
        ...BINH_VENUE,
        descriptionVi:
          'Quán ốc lâu năm giữa phố, nổi tiếng với ốc hương rang muối ớt và nghêu hấp sả. Bàn ghế nhựa kê ra tận vỉa hè, đông nhất sau chín giờ tối.',
        // S2 changes all five kinds of field: text, photos, hours, menu and the pin.
        location: { lat: 10.7755, lng: 106.7008 },
        openingHours: [
          { weekday: 1, opensAt: '15:00', closesAt: '23:30', isClosed: false },
          ...BINH_VENUE.openingHours.slice(1),
        ],
        photos: [
          ...detail.place.photos.map((photo) => ({
            photoId: photo.id,
            altTextVi: photo.altTextVi,
          })),
          { uploadId: await upload(binh, [200, 160, 64]), altTextVi: 'Đĩa ốc hương rang muối' },
        ],
        menu: {
          ...BINH_VENUE.menu,
          items: [
            BINH_VENUE.menu.items[0]!,
            { ...BINH_VENUE.menu.items[1]!, priceMinor: 95000 },
            { nameVi: 'Nghêu hấp sả', descriptionVi: null, priceMinor: 70000, isAvailable: true },
          ],
        },
      },
    });
  }
  if (!rows.some((row) => row.payload.nameVi === 'Bánh mì Hòa Mã')) {
    const an = await actor(PEOPLE.an);
    await an.call('POST', '/owner/submissions', {
      kind: 'CREATE',
      payload: {
        ...OC_OANH,
        nameVi: 'Bánh mì Hòa Mã',
        location: { lat: 10.7768, lng: 106.6936 },
        photos: [],
      },
    });
  }
  await untilNarrationIdle(admin);
  rows = await pending(admin);
  return { admin, rows };
}

/** An admin's change to Ốc Bình since Bình sent his: the conflict (S1, S3), made once after S2. */
async function conflict(admin: Actor): Promise<void> {
  const { venue } = await binhVenue();
  const { data } = await admin.call<{ data: { phone: string | null } }>(
    'GET',
    `/admin/places/${venue}`,
  );
  if (data.phone !== '+84283829000') {
    await admin.call('PATCH', `/admin/places/${venue}`, { phone: '+84283829000' });
  }
}

async function open(page: Page, rows: Row[], name: (row: Row) => boolean): Promise<string> {
  const row = rows.find(name)!;
  await as(page, PEOPLE.lan);
  await page.goto(`/submissions/${row.id}`);
  await page.waitForLoadState('networkidle');
  return row.id;
}

test('S2 a submission, S4 approve, S5 reject', async ({ page }) => {
  const { rows } = await queue();
  // Bình's update before the admin's change: the frame's S2 has no conflict yet.
  await open(page, rows, (row) => row.payload.nameVi === BINH_VENUE.nameVi);
  await expect(page.getByRole('heading', { name: /^Changes to / })).toBeVisible();
  await look(page, 's2-submission');
  await page.getByRole('button', { name: 'Approve…' }).click();
  await expect(page.getByRole('dialog', { name: /^Approve / })).toBeVisible();
  await look(page, 's4-approve', { viewportOnly: true });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Reject…' }).click();
  await expect(page.getByRole('dialog', { name: /^Reject / })).toBeVisible();
  await look(page, 's5-reject', { viewportOnly: true });
});

test('S1 the queue', async ({ page }) => {
  const { admin } = await queue();
  await conflict(admin);
  await as(page, PEOPLE.lan);
  await page.goto('/submissions');
  await expect(page.getByText('Changed since sent').first()).toBeVisible();
  // Each row's area is read from the areas, which arrive after the list.
  await expect(page.getByText(/Vĩnh Khánh food street/).first()).toBeVisible();
  await look(page, 's1-queue', { extra: ['720', '360'] });
});

test('S3 a conflict', async ({ page }) => {
  const { admin, rows } = await queue();
  await conflict(admin);
  await open(page, rows, (row) => row.payload.nameVi === BINH_VENUE.nameVi);
  await expect(page.getByText(/^Changed since this was sent: phone/)).toBeVisible();
  await look(page, 's3-conflict');
});

test('S6 a create submission', async ({ page }) => {
  const { rows } = await queue();
  await open(
    page,
    rows,
    (row) => row.kind === 'CREATE' && row.payload.nameVi.startsWith('Quán Nướng Mẫu'),
  );
  await expect(page.getByRole('heading', { name: /^New venue: / })).toBeVisible();
  await look(page, 's6-create-submission');
});

test('S4b already decided', async ({ page }) => {
  const { admin, rows } = await queue();
  const id = await open(page, rows, (row) => row.payload.nameVi === 'Bánh mì Hòa Mã');
  await admin.call('POST', `/admin/submissions/${id}/reject`, {
    decisionNote: 'Decided in another session.',
  });
  await page.getByRole('button', { name: 'Approve…' }).click();
  await page
    .getByRole('dialog', { name: /^Approve / })
    .getByRole('button', { name: 'Approve', exact: true })
    .click();
  await expect(page.getByText('Already decided')).toBeVisible();
  await look(page, 's4b-already-decided');
});
