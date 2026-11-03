// The web's records (K16), made through the admin API with fixed names: Places with their stories
// made by the fake narration, found again by name on a second run.
import { expect } from '@playwright/test';
import { Actor, API, envValue } from './stack';

/** The seeded admin, signed in. */
export async function admin(): Promise<Actor> {
  const actor = new Actor();
  await actor.signIn('admin@wayfare.test', envValue('identity', 'SEED_ACCOUNT_PASSWORD'));
  return actor;
}

export interface WebPlace {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/** The link form of a code, `K7M2-9QXA`. */
export const linkCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

/** A live editorial Place by its Vietnamese name: found, or made and activated. */
export async function place(
  actor: Actor,
  input: {
    name: string;
    description: string;
    category: string;
    location: { lat: number; lng: number };
    openingHours?: { weekday: number; opensAt: string; closesAt: string; isClosed: boolean }[];
  },
): Promise<WebPlace> {
  const found = await actor.call<{
    data: { id: string; nameVi: string; publicCode: string; deletedAt: string | null }[];
  }>('GET', `/admin/places?q=${encodeURIComponent(input.name)}&includeDeleted=true&pageSize=50`);
  const existing = found.data.find((row) => row.nameVi === input.name);
  // Taken down on an earlier run: as it should be.
  if (existing?.deletedAt != null)
    return { id: existing.id, code: linkCode(existing.publicCode), name: input.name };
  let id = existing?.id;
  if (id === undefined) {
    const { data } = await actor.call<{ data: { place: { id: string } } }>(
      'POST',
      '/admin/places',
      {
        nameVi: input.name,
        descriptionVi: input.description,
        categoryCode: input.category,
        location: input.location,
        addressVi: '1 Công xã Paris, Bến Nghé, Quận 1',
        triggerRadiusM: 30,
        narrationPriority: 50,
        photos: [],
        openingHours: input.openingHours ?? [
          ...[1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
            weekday,
            opensAt: '00:00',
            closesAt: '23:59',
            isClosed: false,
          })),
        ],
        requestActivation: true,
      },
    );
    id = data.place.id;
  }
  await expect
    .poll(
      async () =>
        (await actor.call<{ data: { status: string } }>('GET', `/admin/places/${id}`)).data.status,
      { timeout: 180_000, intervals: [2_000] },
    )
    .toBe('ACTIVE');
  const { data } = await actor.call<{ data: { publicCode: string } }>('GET', `/admin/places/${id}`);
  return { id: id, code: linkCode(data.publicCode), name: input.name };
}

/** Waits until a Place's story in `lang` has its stored audio. */
export async function untilAudio(placeId: string, lang: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const answer = await fetch(`${API}/narration/places/${placeId}/status?lang=${lang}`, {
          headers: { 'x-wayfare-client': 'web' },
        });
        // Not yet known to narration is an error answer: not ready either.
        if (!answer.ok) return false;
        return ((await answer.json()) as { data: { audio: unknown } }).data.audio !== null;
      },
      { timeout: 180_000, intervals: [2_000] },
    )
    .toBe(true);
}

/** The suite's Places (K16): in District 1 centre, a little apart. */
export const PLACES = {
  /** A stored story in English and Vietnamese. */
  church: {
    name: 'Nhà thờ thử Web',
    description:
      'Nhà thờ được xây bằng gạch đỏ chở từ Toulouse giữa năm 1863 và 1880. Hai tháp chuông cao 58 mét được thêm vào năm 1895.',
    category: 'CHURCH',
    location: { lat: 10.7798, lng: 106.699 },
  },
  /** A second story, for Up next and the favourites. */
  opera: {
    name: 'Nhà hát thử Web',
    description:
      'Nhà hát mở cửa năm 1900, trông ra đầu đường Lê Lợi, mặt tiền lấy cảm hứng từ Petit Palais ở Paris.',
    category: 'LANDMARK',
    location: { lat: 10.7766, lng: 106.7031 },
  },
  /** A Place taken off Wayfare after it went live: its sticker stays on the wall (WQ4, WQ5c). */
  gone: {
    name: 'Quán thử Web đã đóng',
    description: 'Một quán nhỏ từng ở đây, nay đã đóng cửa.',
    category: 'LANDMARK',
    location: { lat: 10.7731, lng: 106.7002 },
  },
} as const;

/** Takes a Place off Wayfare (soft-deleted): its code now answers `PLACE_UNAVAILABLE`. */
export async function takeDown(actor: Actor, placeId: string): Promise<void> {
  await actor.call('DELETE', `/admin/places/${placeId}`, undefined, [204, 404, 409]);
}
