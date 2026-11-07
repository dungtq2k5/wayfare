// Analytics in the browser for the specs: the stored consent written straight to IndexedDB (no
// waiting days), and a story "heard" by the audio element's own events.
import type { Page } from '@playwright/test';

/** The player's audio is never in the document: keep the one playing where the spec can drive it. */
export async function keepAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      (window as unknown as { __wfAudio?: HTMLMediaElement }).__wfAudio = this;
      return play.call(this);
    };
  });
}

/** The story sounds for `ms`, then plays to its end: the audio element's own events. */
export async function hear(page: Page, ms = 1_300): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __wfAudio?: HTMLMediaElement }).__wfAudio !== undefined,
  );
  await page.evaluate(() =>
    (window as unknown as { __wfAudio: HTMLMediaElement }).__wfAudio.dispatchEvent(
      new Event('playing'),
    ),
  );
  await page.waitForTimeout(ms);
  await page.evaluate(() =>
    (window as unknown as { __wfAudio: HTMLMediaElement }).__wfAudio.dispatchEvent(
      new Event('ended'),
    ),
  );
}

/** The analytics state as the browser stores it, with the fields a spec sets. */
export async function storeAnalytics(page: Page, fields: Record<string, unknown>): Promise<void> {
  await appDatabase(page);
  await page.evaluate(async (patch) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('wayfare');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('request failed'));
    });
    const now = Date.now();
    const state = {
      choice: null,
      policyVersion: null,
      accepted: false,
      asked: 0,
      due: false,
      knownPolicyVersion: '2026-09-01',
      current: null,
      grantPending: false,
      remembered: [],
      withdrawalsPending: [],
      sessionId: null,
      lastRecordedAt: null,
      sentAt: [],
      retryAt: null,
      failures: 0,
      lastSend: null,
      ...patch,
    };
    if (patch.choice === 'GRANTED' && patch.current === undefined) {
      const id = crypto.randomUUID();
      Object.assign(state, {
        current: { id, createdAt: now, lastUsedAt: now },
        remembered: [{ id, createdAt: now, lastUsedAt: now }],
      });
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(JSON.stringify(state), 'analytics');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('transaction failed'));
    });
    db.close();
  }, fields);
}

/**
 * Waits until the app opened its own database (version 3): opening it first, without a version,
 * would make an empty one the app then can't upgrade.
 */
async function appDatabase(page: Page): Promise<void> {
  // The listing shows version 3 while its upgrade still runs; an open waits for the upgrade, then
  // the stores are there.
  await page.waitForFunction(async () => {
    const listed = (await indexedDB.databases()).some(
      (database) => database.name === 'wayfare' && (database.version ?? 0) >= 3,
    );
    if (!listed) return false;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('wayfare');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('request failed'));
    });
    const ready = db.objectStoreNames.contains('kv') && db.objectStoreNames.contains('analytics');
    db.close();
    return ready;
  });
}

/** What the browser has stored, read back. */
export async function storedAnalytics(page: Page): Promise<Record<string, unknown> | null> {
  await appDatabase(page);
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('wayfare');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('request failed'));
    });
    const value = await new Promise<unknown>((resolve) => {
      const get = db.transaction('kv').objectStore('kv').get('analytics');
      get.onsuccess = () => resolve(get.result);
    });
    db.close();
    return typeof value === 'string' ? (JSON.parse(value) as Record<string, unknown>) : null;
  });
}
