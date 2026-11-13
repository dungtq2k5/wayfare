/** How many times, and how far apart, a transaction asks again for a lock another write holds. */
const LOCK_TRIES = 8;
const LOCK_BACKOFF_MS = 250;

/**
 * An exclusive transaction's own connection has no busy timeout, so its `BEGIN` fails at once while
 * another connection writes (an area's download updating at launch). It never began, so nothing
 * ran: it is asked again, a little later each time, before the failure is the caller's.
 */
export async function whenUnlocked<T>(
  begin: () => Promise<T>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await begin();
    } catch (error) {
      if (attempt >= LOCK_TRIES || !/database is locked/i.test(String(error))) throw error;
      await wait(LOCK_BACKOFF_MS * attempt);
    }
  }
}
