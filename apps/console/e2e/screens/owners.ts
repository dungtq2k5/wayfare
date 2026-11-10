// The owners the screens make for themselves (round 36's people and their venues, and billing's own
// past-due and ended accounts), through the API with fixed names, so no file changes records another
// reads. Each helper finds its record first: a spec runs on
// its own after the others, and a fresh stack gets each record once.
import { expect } from '@playwright/test';
import { apply, owner, PASSWORD, verifiedUser } from '../support/people';
import { Actor, mailTo } from '../support/stack';
import {
  accountOf,
  checkout,
  seconds,
  sendStripeEvent,
  subscription,
  untilEvent,
} from '../support/stripe';
import { actor, findPlace, OC_OANH, untilStatus, upload } from './content';
import { PEOPLE } from './setup';

/** The round's people beside Minh: an applicant approved onto Free, and the applicants' states. */
export const OWNERS = {
  /** Trần Bảo Ngọc: applies (N4–N5), is approved onto Free (N8, M1b, Y1b, Y2, Y3…). */
  ngoc: 'ngoc.tran@example.com',
  /** An application not approved (N6, N6b). */
  trang: 'trang.pham@example.com',
  /** An application withdrawn (N7). */
  tuan: 'tuan.do@example.com',
  /** An account that never verified its address (N2, N2b). */
  chi: 'chi.vu@example.com',
  /** An owner who chooses Growth and pays through the fake Checkout (Y1, Y2, Y3, Y3b, Y4, Y7). */
  khanh: 'khanh.ly@example.com',
  /** An owner whose Growth cancels at the period's end (Y6). */
  vy: 'vy.nguyen@example.com',
  /** An owner, and only an owner, whose Growth Wayfare pinned by hand (Y1c). */
  hoa: 'hoa.dang@example.com',
  /** An owner whose Growth ended, a venue off the map (Y6b). */
  loc: 'loc.huynh@example.com',
  /** An owner on Growth whose card fails: past due (W2b). */
  thuy: 'thuy.le@example.com',
  /** An owner whose Pro subscription ended (W2c). */
  phuc: 'phuc.vo@example.com',
  /** The submissions' owner: his update of his venue is the queue's S2 and S3. */
  binh: 'binh.tran@example.com',
} as const;

const exists = async (admin: Actor, email: string) =>
  (await admin.call<{ data: unknown[] }>('GET', `/admin/users?q=${encodeURIComponent(email)}`)).data
    .length > 0;

async function named(person: Actor, fullName: string): Promise<void> {
  await person.call('PATCH', '/users/me', { fullName });
}

/** A verified account with its name, once. */
export async function person(email: string, fullName: string): Promise<Actor> {
  const admin = await actor(PEOPLE.lan);
  if (!(await exists(admin, email))) await named(await verifiedUser(email), fullName);
  return actor(email);
}

/** An account registered and never verified (N2), once. */
export async function unverifiedPerson(email: string, fullName: string): Promise<Actor> {
  const admin = await actor(PEOPLE.lan);
  if (!(await exists(admin, email))) {
    await new Actor().call('POST', '/auth/register', {
      email,
      password: PASSWORD,
      fullName,
      preferredLocale: 'en',
      termsVersion: '2026-09-01',
    });
    await mailTo(email, /Confirm your email/);
  }
  return actor(email);
}

/** A verified owner on Free, once (approved through the reviewer's routes). */
export async function freeOwner(email: string, fullName: string): Promise<Actor> {
  const lan = await actor(PEOPLE.lan);
  if (!(await exists(lan, email))) await named(await owner(lan, email), fullName);
  const signedIn = await actor(email);
  // The plan reaches billing from the approval's event a moment later.
  await expect(async () => {
    await signedIn.call('GET', '/owner/places/limits');
  }).toPass({ timeout: 60_000 });
  return signedIn;
}

/** Sends a Stripe event unless the stack recorded it already, and waits until billing settled it. */
export async function sendOnce(
  admin: Actor,
  event: Parameters<typeof sendStripeEvent>[0],
): Promise<void> {
  const { data } = await admin.call<{ data: { stripeEventId: string }[] }>(
    'GET',
    '/admin/billing/events?pageSize=100',
  );
  if (!data.some((row) => row.stripeEventId === event.id)) await sendStripeEvent(event);
  await untilEvent(admin, event.id, ['PROCESSED']);
}

/**
 * An owner subscribed by signed webhooks, as Stripe would — to Growth unless another price is
 * named — with ids fixed by `tag`, once: `sub_screens<tag>`, `cus_screens<tag>`.
 */
export async function subscribe(
  mai: Actor,
  email: string,
  tag: string,
  { price = 'price_dev_growth_month', cancelAtPeriodEnd = false } = {},
): Promise<void> {
  const account = (await accountOf(mai, email)).id;
  await sendOnce(mai, {
    id: `evt_screens${tag}Checkout`,
    type: 'checkout.session.completed',
    created: seconds(-6),
    object: checkout(account, `cus_screens${tag}`, `sub_screens${tag}`),
  });
  await sendOnce(mai, {
    id: `evt_screens${tag}Created`,
    type: 'customer.subscription.created',
    created: seconds(-5),
    object: subscription({
      id: `sub_screens${tag}`,
      customer: `cus_screens${tag}`,
      status: 'active',
      price,
      periodEnd: seconds(30 * 86_400),
      cancelAtPeriodEnd,
    }),
  });
}

/** The applicant's newest application, sent once with the frames' answers. */
export async function applicationOf(
  applicant: Actor,
  business: string,
): Promise<{ id: string; status: string }> {
  const { data } = await applicant.call<{ data: { id: string; status: string }[] }>(
    'GET',
    '/owner/registration',
  );
  if (data[0] !== undefined) return data[0];
  const id = await apply(applicant, business, { businessRegistrationNo: '0312345678' });
  return { id, status: 'PENDING' };
}

/** A venue the frames name, as an owner sends it: Ốc Oanh's shape at its own point. */
export const venue = (nameVi: string, lat: number, lng: number, descriptionVi?: string) => ({
  ...OC_OANH,
  websiteUrl: null as string | null,
  nameVi,
  ...(descriptionVi === undefined ? {} : { descriptionVi }),
  location: { lat, lng },
  addressVi: `${Math.round((lat - 10.77) * 100_000)} Vĩnh Khánh, Phường 8, Quận 4`,
});
export type VenuePayload = ReturnType<typeof venue>;

/** The owner's waiting `CREATE` of `name`, if any. */
async function waitingCreate(person: Actor, name: string): Promise<string | undefined> {
  const { data } = await person.call<{
    data: { id: string; kind: string; status: string; payload: { nameVi: string } }[];
  }>('GET', '/owner/submissions?limit=50&status=PENDING');
  return data.find((row) => row.kind === 'CREATE' && row.payload.nameVi === name)?.id;
}

/**
 * The owner's `CREATE` of `payload`, waiting: sent once (a send that timed out on a loaded machine
 * may still have arrived, so it is looked for first and after).
 */
export async function sentVenue(
  person: Actor,
  payload: VenuePayload,
  photo = true,
): Promise<string> {
  const found = await waitingCreate(person, payload.nameVi);
  if (found !== undefined) return found;
  const photos = photo
    ? [{ uploadId: await upload(person, [190, 120, 60]), altTextVi: 'Mặt tiền quán' }]
    : [];
  try {
    const { data } = await person.call<{ data: { submission: { id: string } } }>(
      'POST',
      '/owner/submissions',
      { kind: 'CREATE', payload: { ...payload, photos } },
    );
    return data.submission.id;
  } catch (error) {
    for (let poll = 0; poll < 10; poll++) {
      await new Promise((done) => setTimeout(done, 3_000));
      const late = await waitingCreate(person, payload.nameVi);
      if (late !== undefined) return late;
    }
    throw error;
  }
}

/** A live venue of the owner's: their creation, approved, its audio made; its id. */
export async function liveVenue(person: Actor, payload: VenuePayload): Promise<string> {
  const lan = await actor(PEOPLE.lan);
  const found = await findPlace(lan, payload.nameVi);
  if (found !== null) return found.id;
  const id = await sentVenue(person, payload);
  const { data } = await lan.call<{ data: { submission: { placeId: string } } }>(
    'POST',
    `/admin/submissions/${id}/approve`,
    { triggerRadiusM: 25, narrationPriority: 50 },
  );
  await untilStatus(lan, data.submission.placeId, 'ACTIVE');
  return data.submission.placeId;
}

/** The venue's own photos now, as a submission keeps them. */
async function keptPhotos(person: Actor, placeId: string) {
  const { data } = await person.call<{
    data: { editableHash: string; place: { photos: { id: string; altTextVi: string | null }[] } };
  }>('GET', `/owner/places/${placeId}`);
  return {
    hash: data.editableHash,
    photos: data.place.photos.map((photo) => ({ photoId: photo.id, altTextVi: photo.altTextVi })),
  };
}

/** The owner's `UPDATE` of a venue, waiting, sent once; its id. */
export async function changeWaiting(
  person: Actor,
  placeId: string,
  payload: VenuePayload,
): Promise<string> {
  const { data: waiting } = await person.call<{ data: { id: string }[] }>(
    'GET',
    `/owner/submissions?placeId=${placeId}&status=PENDING`,
  );
  if (waiting[0] !== undefined) return waiting[0].id;
  const { hash, photos } = await keptPhotos(person, placeId);
  const { data } = await person.call<{ data: { submission: { id: string } } }>(
    'POST',
    '/owner/submissions',
    { kind: 'UPDATE', placeId, baseEditableHash: hash, payload: { ...payload, photos } },
  );
  return data.submission.id;
}

/** A change to a venue, not approved with the admin's note, once; its id. */
export async function changeRejected(
  person: Actor,
  placeId: string,
  payload: VenuePayload,
  note: string,
): Promise<string> {
  const { data: rejected } = await person.call<{ data: { id: string }[] }>(
    'GET',
    `/owner/submissions?placeId=${placeId}&status=REJECTED`,
  );
  if (rejected[0] !== undefined) return rejected[0].id;
  const id = await changeWaiting(person, placeId, payload);
  const lan = await actor(PEOPLE.lan);
  await lan.call('POST', `/admin/submissions/${id}/reject`, { decisionNote: note });
  return id;
}

/** Minh's venues (K17): Ốc Oanh from round 34, and the three this round makes. */
export const MINH_VENUES = {
  banhXeo: venue(
    'Bánh xèo Mười Xiềm',
    10.7755,
    106.7008,
    'Bánh xèo miền Tây giòn rụm, đổ bằng chảo gang trên bếp than, ăn với rau rừng và nước mắm chua ngọt.',
  ),
  ocVu: venue(
    'Ốc Vũ',
    10.7758,
    106.7001,
    'Quán ốc gia đình mở từ năm 2009, nổi tiếng với ốc móng tay xào bơ tỏi và nghêu hấp sả.',
  ),
  lauDe: venue(
    'Lẩu dê Vĩnh Khánh',
    10.7749,
    106.7011,
    'Lẩu dê thuốc bắc nấu theo công thức nhà, thơm mùi ngải cứu, ăn kèm chao và rau cải.',
  ),
  /** A new venue waiting for review: it holds one of his places (K7). */
  soDiep: venue('Sò điệp Năm Đô', 10.7761, 106.7005),
};

/** Bình's venue, which only the submissions' frames (S1–S3) change. */
export const BINH_VENUE = venue('Ốc Bình', 10.7752, 106.7012);

/** Ngọc's venue, and the one she adds while it is closed (M4). */
export const NGOC_VENUES = {
  ocNgoc: venue('Ốc Ngọc Vĩnh Khánh', 10.7746, 106.7003),
  che: venue('Chè Ngọc', 10.7744, 106.7009),
};
