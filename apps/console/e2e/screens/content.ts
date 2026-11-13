// Round 34's records, made through the API with fixed names. Each helper finds its record first,
// so a spec can run on its own after the others, and a fresh stack gets each record once.
import { expect } from '@playwright/test';
import { photoFile } from '../support/content';
import { PASSWORD } from '../support/people';
import { Actor } from '../support/stack';
import { PEOPLE } from './setup';

/** Signed in through the API as one of the screens' people. */
export async function actor(email: string): Promise<Actor> {
  const signedIn = new Actor();
  await signedIn.signIn(email, PASSWORD);
  return signedIn;
}

interface PlaceRow {
  id: string;
  nameVi: string;
  status: string;
  deletedAt: string | null;
}

/** The Place named exactly `name`, deleted ones included, or null. */
export async function findPlace(admin: Actor, name: string): Promise<PlaceRow | null> {
  const { data } = await admin.call<{ data: PlaceRow[] }>(
    'GET',
    `/admin/places?q=${encodeURIComponent(name)}&includeDeleted=true&pageSize=50`,
  );
  return data.find((row) => row.nameVi === name) ?? null;
}

/** A confirmed photo upload of one colour; its id. */
export async function upload(owner: Actor, colour: [number, number, number]): Promise<string> {
  const { buffer, mimeType } = photoFile('photo.png', colour);
  const { data: signed } = await owner.call<{
    data: { uploadId: string; uploadUrl: string; requiredHeaders: Record<string, string> };
  }>('POST', '/uploads', { purpose: 'PLACE_PHOTO', contentType: mimeType, bytes: buffer.length });
  const put = await fetch(signed.uploadUrl, {
    method: 'PUT',
    headers: signed.requiredHeaders,
    body: new Uint8Array(buffer),
  });
  if (!put.ok) throw new Error(`upload PUT → ${put.status}`);
  await owner.call('POST', `/uploads/${signed.uploadId}/confirm`);
  return signed.uploadId;
}

const PHOTO_COLOURS: [number, number, number][] = [
  [176, 96, 48],
  [48, 120, 96],
  [96, 72, 160],
];

/** An Editorial Place in Quận 1, live (or a draft); its id. */
export async function editorialPlace(
  admin: Actor,
  place: {
    name: string;
    description: string;
    category: string;
    location: { lat: number; lng: number };
    /** Each photo's alt text, which the page shows as its caption; one photo each. */
    captions?: string[];
    live?: boolean;
  },
): Promise<string> {
  const found = await findPlace(admin, place.name);
  if (found !== null) return found.id;
  const photos = [];
  for (const [index, caption] of (place.captions ?? []).entries()) {
    photos.push({ uploadId: await upload(admin, PHOTO_COLOURS[index]!), altTextVi: caption });
  }
  const { data } = await admin.call<{ data: { place: { id: string } } }>('POST', '/admin/places', {
    nameVi: place.name,
    descriptionVi: place.description,
    categoryCode: place.category,
    location: place.location,
    addressVi: null,
    triggerRadiusM: 30,
    narrationPriority: 50,
    photos,
    openingHours: [
      { weekday: 1, opensAt: '06:00', closesAt: '18:00', isClosed: false },
      { weekday: 7, opensAt: '06:00', closesAt: '20:00', isClosed: false },
    ],
    requestActivation: place.live ?? true,
  });
  if (place.live ?? true) await untilStatus(admin, data.place.id, 'ACTIVE');
  return data.place.id;
}

/** Waits for a Place's status (the fake narration answers in seconds). */
export async function untilStatus(admin: Actor, id: string, status: string): Promise<void> {
  await expect
    .poll(
      async () =>
        (await admin.call<{ data: { status: string } }>('GET', `/admin/places/${id}`)).data.status,
      {
        timeout: 90_000,
      },
    )
    .toBe(status);
}

/** Waits until no narration job is queued or running, so the monitor and the Places stand still. */
export async function untilNarrationIdle(admin: Actor): Promise<void> {
  await expect
    .poll(
      async () => {
        const { meta } = await admin.call<{ meta: { total: number } }>(
          'GET',
          '/admin/narration/jobs?status=RUNNING&pageSize=1',
        );
        const queued = await admin.call<{ meta: { total: number } }>(
          'GET',
          '/admin/narration/jobs?status=QUEUED&pageSize=1',
        );
        return meta.total + queued.meta.total;
      },
      { timeout: 600_000, intervals: [5_000] },
    )
    .toBe(0);
}

/** Minh Tran's Venue, Ốc Oanh: his creation, approved; its id. */
export async function ocOanh(): Promise<string> {
  const admin = await actor(PEOPLE.lan);
  const found = await findPlace(admin, OC_OANH.nameVi);
  if (found !== null) return found.id;
  const minh = await actor(PEOPLE.minh);
  // A send that timed out on a loaded machine may still have arrived: his plan holds one Venue, so
  // a second send is refused. The one waiting is approved instead.
  const sent = async () =>
    (
      await minh.call<{
        data: { id: string; kind: string; status: string; payload: { nameVi: string } }[];
      }>('GET', '/owner/submissions?limit=50')
    ).data.find(
      (row) =>
        row.kind === 'CREATE' && row.status === 'PENDING' && row.payload.nameVi === OC_OANH.nameVi,
    )?.id;
  let id = await sent();
  if (id === undefined) {
    const photo = await upload(minh, PHOTO_COLOURS[0]!);
    try {
      const { data: created } = await minh.call<{ data: { submission: { id: string } } }>(
        'POST',
        '/owner/submissions',
        {
          kind: 'CREATE',
          payload: { ...OC_OANH, photos: [{ uploadId: photo, altTextVi: 'Mặt tiền quán' }] },
        },
      );
      id = created.submission.id;
    } catch (error) {
      // It lands a few seconds after the timeout, if at all.
      for (let poll = 0; poll < 10 && id === undefined; poll++) {
        await new Promise((done) => setTimeout(done, 3_000));
        id = await sent();
      }
      if (id === undefined) throw error;
    }
  }
  const { data } = await admin.call<{ data: { submission: { placeId: string } } }>(
    'POST',
    `/admin/submissions/${id}/approve`,
    { triggerRadiusM: 25, narrationPriority: 55 },
  );
  await untilStatus(admin, data.submission.placeId, 'ACTIVE');
  return data.submission.placeId;
}

/** Ốc Oanh as Minh submits it: a complete owner payload. */
export const OC_OANH = {
  nameVi: 'Ốc Oanh',
  descriptionVi:
    'Quán ốc lâu năm giữa phố, nổi tiếng với ốc hương rang muối ớt và sò điệp nướng mỡ hành. Bàn ghế nhựa kê ra tận vỉa hè, đông nhất sau tám giờ tối.',
  categoryCode: 'RESTAURANT',
  location: { lat: 10.7752, lng: 106.7004 },
  addressVi: '534 Vĩnh Khánh, Phường 8, Quận 4',
  priceBand: 2,
  phone: '+84903123456',
  websiteUrl: null,
  openingHours: [
    { weekday: 1, opensAt: '16:00', closesAt: '23:30', isClosed: false },
    { weekday: 6, opensAt: '15:00', closesAt: '23:59', isClosed: false },
    { weekday: 7, opensAt: '15:00', closesAt: '23:59', isClosed: false },
  ],
  menu: {
    menuCurrency: 'VND',
    items: [
      {
        nameVi: 'Ốc hương rang muối ớt',
        descriptionVi: null,
        priceMinor: 120000,
        isAvailable: true,
      },
      {
        nameVi: 'Sò điệp nướng mỡ hành',
        descriptionVi: null,
        priceMinor: 90000,
        isAvailable: true,
      },
      { nameVi: 'Bia Sài Gòn', descriptionVi: null, priceMinor: 25000, isAvailable: true },
    ],
  },
};

/** Waits until a record's audit rows stop arriving: they reach the log after the change. */
export async function untilAuditSettled(admin: Actor, resourceId: string): Promise<void> {
  const count = async () =>
    (
      await admin.call<{ data: unknown[] }>(
        'GET',
        `/admin/audit-logs?resourceId=${resourceId}&from=${new Date(Date.now() - 30 * 86_400_000).toISOString()}&to=${new Date().toISOString()}&limit=100`,
      )
    ).data.length;
  let last = -1;
  for (let poll = 0; poll < 20; poll++) {
    const now = await count();
    if (now === last && now > 0) return;
    last = now;
    await new Promise((done) => setTimeout(done, 3_000));
  }
}
