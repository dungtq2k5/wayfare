// A boosted Venue near District 1's centre, made as round 38 makes one (K11): an owner approved,
// their Venue live, Growth by signed webhooks, the boost set through `PUT /owner/boosts` — the
// console's own helpers, so the stack holds a real boost, not a written column.
import { expect } from '@playwright/test';
import { owner, SUPER_ADMIN } from '../../../console/e2e/support/people';
import { Actor as ConsoleActor } from '../../../console/e2e/support/stack';
import {
  accountOf,
  checkout,
  seconds,
  sendStripeEvent,
  subscription,
} from '../../../console/e2e/support/stripe';
import { findPlace, untilStatus } from '../../../console/e2e/screens/content';
import { sentVenue, venue } from '../../../console/e2e/screens/owners';
import { linkCode } from './places';

/** The sponsored Venue's owner and name (BT1). */
export const SPONSOR = {
  email: 'binh.sponsor@example.com',
  name: 'Bánh xèo thử Web',
  /** About 160 m from the map's centre: its boost moves it ahead of a nearer Place, so it is sponsored. */
  at: { lat: 10.7779, lng: 106.7009 },
} as const;

/** The boosted Venue, made once; its id and link code. */
export async function boostedVenue(): Promise<{ id: string; code: string; name: string }> {
  const admin = new ConsoleActor();
  await admin.signIn(SUPER_ADMIN.email, SUPER_ADMIN.password);
  let place = await findPlace(admin, SPONSOR.name);
  let person: ConsoleActor;
  if (place === null) {
    person = await owner(admin, SPONSOR.email);
    const submissionId = await sentVenue(
      person,
      venue(SPONSOR.name, SPONSOR.at.lat, SPONSOR.at.lng),
    );
    const { data } = await admin.call<{ data: { submission: { placeId: string } } }>(
      'POST',
      `/admin/submissions/${submissionId}/approve`,
      { triggerRadiusM: 25, narrationPriority: 50 },
    );
    await untilStatus(admin, data.submission.placeId, 'ACTIVE');
    place = await findPlace(admin, SPONSOR.name);
  } else {
    person = new ConsoleActor();
    await person.signIn(SPONSOR.email, 'console e2e password');
  }
  const id = place!.id;
  // Growth — one boost slot — as Stripe would send it.
  const account = (await accountOf(admin, SPONSOR.email)).id;
  for (const event of [
    {
      id: 'evt_webSponsorCheckout',
      type: 'checkout.session.completed',
      created: seconds(-6),
      object: checkout(account, 'cus_webSponsor', 'sub_webSponsor'),
    },
    {
      id: 'evt_webSponsorCreated',
      type: 'customer.subscription.created',
      created: seconds(-5),
      object: subscription({
        id: 'sub_webSponsor',
        customer: 'cus_webSponsor',
        status: 'active',
        price: 'price_dev_growth_month',
        periodEnd: seconds(30 * 86_400),
      }),
    },
  ]) {
    await sendStripeEvent(event);
  }
  await expect
    .poll(
      async () =>
        (await person.call<{ data: { slots: number } }>('GET', '/owner/boosts')).data.slots,
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);
  await person.call('PUT', '/owner/boosts', { placeIds: [id] });
  // Catalog applies it from billing's event: the list's row says so.
  await expect
    .poll(
      async () =>
        (
          await admin.call<{ data: { id: string; boosted: boolean }[] }>(
            'GET',
            `/admin/places?q=${encodeURIComponent(SPONSOR.name)}`,
          )
        ).data.find((row) => row.id === id)?.boosted,
      { timeout: 60_000, intervals: [1_000] },
    )
    .toBe(true);
  const { data: detail } = await admin.call<{ data: { publicCode: string } }>(
    'GET',
    `/admin/places/${id}`,
  );
  return { id, code: linkCode(detail.publicCode), name: SPONSOR.name };
}
