'use client';

import { analyticsTransport } from '@wayfare/api-client';
import { LEGAL_DOCUMENT_VERSIONS, LegalDocument, newId } from '@wayfare/contracts';
import { AnalyticsClient, NarrationTracker } from '@wayfare/core';
import type { AnalyticsState, RecordInput } from '@wayfare/core';
import { readKv, writeKv } from '../client/db';
import { idbQueue } from './queue';
import { sharedPosition } from './shared-position';

/** Its own value in the browser's `kv`, never beside the device credentials (ADR 0042). */
const STATE_KEY = 'analytics';

/** The sender's pace while the page is visible. */
const SEND_EVERY_MS = 5 * 60 * 1000;

let opened: Promise<AnalyticsClient> | null = null;

/**
 * This browser's analytics (the shared client, ADR 0042): its own consent and id, asked
 * separately from the phone. Opened once per page, in the browser only.
 */
export function analytics(): Promise<AnalyticsClient> {
  opened ??= AnalyticsClient.open({
    load: async () => {
      const stored = await readKv(STATE_KEY, '');
      return stored === '' ? null : (JSON.parse(stored) as AnalyticsState);
    },
    save: (state) => writeKv(STATE_KEY, JSON.stringify(state)),
    queue: idbQueue,
    transport: analyticsTransport,
    newId,
    now: Date.now,
    position: sharedPosition,
    language: () => document.documentElement.lang || 'en',
    buildPolicyVersion: LEGAL_DOCUMENT_VERSIONS[LegalDocument.PRIVACY_POLICY],
  }).then((client) => {
    follow(client);
    return client;
  });
  return opened;
}

/** Records one event — nothing unless this browser allowed it. Never throws. */
export function track(input: RecordInput): void {
  void analytics()
    .then((client) => client.record(input))
    .catch(() => undefined);
}

/** The player's narration, told to this browser's analytics. */
export const narrationTracker = new NarrationTracker(analytics, () => Date.now());

/**
 * The page visible again: another tab may have recorded since (the session's 30 minutes are the
 * browser's, not the tab's), then a session if it's due. Hidden: a story left mid-way is abandoned,
 * and one batch goes with `keepalive`. Online again, and every 5 minutes: a send.
 */
function follow(client: AnalyticsClient): void {
  const visible = () =>
    void client
      .reload()
      .then(() => client.foreground())
      .catch(() => undefined);
  visible();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') visible();
  });
  window.addEventListener('pagehide', () => {
    narrationTracker.end(false);
    void client.flush({ keepalive: true });
  });
  window.addEventListener('online', () => void client.flush());
  setInterval(() => {
    if (document.visibilityState === 'visible') void client.flush();
  }, SEND_EVERY_MS);
}
