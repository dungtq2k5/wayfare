// The content flows' data, set up through the API: Venues from approved owner submissions, update
// submissions against them, and small real images for the uploads.
import { deflateSync } from 'node:zlib';
import { accounts } from './accounts';
import { owner } from './people';
import { Actor } from './stack';

/** The seeded admin, signed in through the API. */
export async function adminActor(): Promise<Actor> {
  const { admin } = accounts();
  const actor = new Actor();
  await actor.signIn(admin.email, admin.password);
  return actor;
}

let made = 0;
/** A point inside the seeded Quận 1 area, a little apart from the last one. */
const nextPoint = () => {
  made += 1;
  const seed = (Date.now() % 997) + made * 7;
  return { lat: 10.7835 - 0.0001 * (seed % 40), lng: 106.694 + 0.0001 * (seed % 120) };
};

/** A Venue's complete owner-editable state, as an owner submits it. */
export const venuePayload = (name: string, location = nextPoint()) => ({
  nameVi: name,
  descriptionVi: 'Bún chả Hà Nội, nướng than hoa.',
  categoryCode: 'RESTAURANT',
  location,
  addressVi: '12 Lê Lợi, Quận 1',
  priceBand: 2,
  phone: '+84901234567',
  websiteUrl: null,
  openingHours: [{ weekday: 1, opensAt: '08:00', closesAt: '21:00', isClosed: false }],
  photos: [] as { photoId?: string; uploadId?: string; altTextVi: string | null }[],
  menu: {
    menuCurrency: 'VND',
    items: [{ nameVi: 'Bún chả', descriptionVi: null, priceMinor: 45000, isAvailable: true }],
  },
});
export type VenuePayload = ReturnType<typeof venuePayload>;

/** A new owner (free plan: one Venue) — each Venue a flow needs gets its own. */
export async function newOwner(admin: Actor, label: string): Promise<Actor> {
  return owner(admin, `${label}-${Date.now().toString(36)}-${made++}@example.com`);
}

/**
 * An owner's `CREATE` submission, pending; its id. A new owner's plan reaches billing from the
 * approval's event a moment later, so `ENTITLEMENTS_UNAVAILABLE` is waited out.
 */
export async function createSubmission(actor: Actor, payload: VenuePayload): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const answer = await actor.call<{ data?: { submission: { id: string } } }>(
      'POST',
      '/owner/submissions',
      { kind: 'CREATE', payload },
      attempt < 25 ? [201, 503] : [201],
    );
    if (answer.data !== undefined) return answer.data.submission.id;
    await new Promise((done) => setTimeout(done, 400));
  }
}

/** A Venue: an owner's creation approved; its id. */
export async function approvedVenue(
  admin: Actor,
  actor: Actor,
  payload: VenuePayload,
): Promise<string> {
  const id = await createSubmission(actor, payload);
  const { data } = await admin.call<{ data: { submission: { placeId: string } } }>(
    'POST',
    `/admin/submissions/${id}/approve`,
    { triggerRadiusM: 30, narrationPriority: 50 },
  );
  return data.submission.placeId;
}

/** An owner's `UPDATE` of their Venue, from its current base; its id. */
export async function updateSubmission(
  actor: Actor,
  placeId: string,
  payload: VenuePayload,
): Promise<string> {
  const { data: place } = await actor.call<{ data: { editableHash: string } }>(
    'GET',
    `/owner/places/${placeId}`,
  );
  const { data } = await actor.call<{ data: { submission: { id: string } } }>(
    'POST',
    '/owner/submissions',
    { kind: 'UPDATE', placeId, baseEditableHash: place.editableHash, payload },
  );
  return data.submission.id;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes: Buffer) => {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, body: Buffer) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
};

/** A real PNG of one colour, `width` × `height`, small enough to upload quickly. */
export function png(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(width).fill([r, g, b]).flat())]);
  const pixels = deflateSync(Buffer.concat(Array<Buffer>(height).fill(row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', pixels),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A photo for the uploader's file input. */
export const photoFile = (name: string, colour: [number, number, number]) => ({
  name,
  mimeType: 'image/png',
  buffer: png(640, 480, colour),
});
