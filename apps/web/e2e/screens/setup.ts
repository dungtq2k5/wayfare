// The web screens' global setup: on the fresh screens stack (the console's stack.sh, the web on
// 5184), the fixture Places with fixed names, the map packs they draw on, and the pinned renderer.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { publishMapPacks } from '../../../console/e2e/screens/map-pack';
import { SUPER_ADMIN } from '../../../console/e2e/support/people';
import { Actor as ConsoleActor } from '../../../console/e2e/support/stack';
import { PLACES, place, takeDown, untilAudio } from '../support/places';
import { Actor, API, clearMail, resetRateLimits } from '../support/stack';
import { expect } from '@playwright/test';
import { STATE_FILE } from '../support/state';
import type { WebState } from '../support/state';
import { startBrowserServer, stopBrowserServer } from './browser';

export async function screensSetup(): Promise<() => void> {
  resetRateLimits();
  await clearMail();
  const admin = new Actor();
  await admin.signIn(SUPER_ADMIN.email, SUPER_ADMIN.password);
  // The console's own helper, with its own session: the packs as an admin registers them.
  const packs = new ConsoleActor();
  await packs.signIn(SUPER_ADMIN.email, SUPER_ADMIN.password);
  await publishMapPacks(packs);
  const church = await place(admin, PLACES.church);
  const opera = await place(admin, PLACES.opera);
  const gone = await place(admin, PLACES.gone);
  await takeDown(admin, gone.id);
  await untilAudio(church.id, 'en');
  await untilAudio(opera.id, 'en');
  // The pages drawn in a language the app doesn't ship read their strings from the pipeline: made
  // before any is drawn, so a baseline never catches one half-translated.
  for (const lang of ['fr', 'de', 'ja'])
    for (const namespace of ['web', 'tourist']) await untilBundle(namespace, lang);
  const made: WebState = { church, opera, gone };
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(made));
  resetRateLimits();
  await startBrowserServer();
  return stopBrowserServer;
}

/** Waits until a UI bundle is translated (`READY`). */
async function untilBundle(namespace: string, lang: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const answer = await fetch(`${API}/i18n/bundles/${namespace}/${lang}`, {
          headers: { 'x-wayfare-client': 'web' },
        });
        // A refusal (the read's rate limit) is not an answer: ask again.
        if (!answer.ok) return 'NOT YET';
        return ((await answer.json()) as { data: { status: string } }).data.status;
      },
      { timeout: 600_000, intervals: [5_000] },
    )
    .toBe('READY');
}
