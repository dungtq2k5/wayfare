export type NetworkVerdict = 'online' | 'offline';

export interface ProbeLimits {
  /** One attempt is cut here. */
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  /** No new attempt starts once this much time has passed. */
  readonly windowMs: number;
}

export interface ProbeDeps {
  /** The platform's `fetch`, or a fake; it must honour `signal`. */
  fetch: (url: string, init: { signal: AbortSignal }) => Promise<unknown>;
  now: () => number;
}

/**
 * Asks the gateway whether it answers. Any answer, even an error status, is *online* — the
 * gateway is reachable; no answer within the limits is *offline*. A slow network that answers on
 * the second try is online: the verdict never accuses a slow network of being down (product §9).
 */
export async function probeGateway(
  url: string,
  limits: ProbeLimits,
  deps: ProbeDeps,
): Promise<NetworkVerdict> {
  const started = deps.now();
  for (let attempt = 0; attempt < limits.maxAttempts; attempt += 1) {
    if (attempt > 0 && deps.now() - started >= limits.windowMs) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
    try {
      await deps.fetch(url, { signal: controller.signal });
      return 'online';
    } catch {
      // timed out or unreachable: try again while the window allows
    } finally {
      clearTimeout(timer);
    }
  }
  return 'offline';
}
