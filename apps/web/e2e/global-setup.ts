// The web's records (K16): identity's dev seed gives the admin, who makes the Places through the
// API; their stories are made by the fake narration.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { boostedVenue } from './support/boosts';
import { admin, PLACES, place, takeDown, untilAudio } from './support/places';
import { clearMail, resetRateLimits } from './support/stack';
import { screensSetup } from './screens/setup';
import { STATE_FILE } from './support/state';
import type { WebState } from './support/state';

export default async function globalSetup(): Promise<(() => void) | void> {
  if (process.env.E2E_SUITE === 'screens') return screensSetup();
  resetRateLimits();
  await clearMail();
  const actor = await admin();
  const church = await place(actor, PLACES.church);
  const opera = await place(actor, PLACES.opera);
  const gone = await place(actor, PLACES.gone);
  await takeDown(actor, gone.id);
  await untilAudio(church.id, 'en');
  await untilAudio(opera.id, 'en');
  // Round 38: a boosted Venue near the map's centre, made as an owner makes one.
  const sponsor = await boostedVenue();
  const made: WebState = { church, opera, gone, sponsor };
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(made));
  resetRateLimits();
}
