import { NARRATION_CONFIG } from '@wayfare/contracts';
import { create } from 'zustand';
import { API_URL } from '../env';
import { probeGateway } from './probe';
import type { NetworkVerdict } from './probe';

interface NetworkState {
  /** `unknown` until the first probe settles. */
  status: 'unknown' | NetworkVerdict;
}

/** The probe's verdict: client state, not server state (ADR 0029). */
export const useNetworkStore = create<NetworkState>(() => ({ status: 'unknown' }));

/** `/health` is outside the `/api` prefix, so it hangs off the API's origin. */
export const healthUrl = `${new URL(API_URL).origin}/health`;

/** Asks the gateway, with the product's limits (§9), and records the answer. */
export async function checkNetwork(): Promise<NetworkVerdict> {
  const verdict = await probeGateway(
    healthUrl,
    {
      timeoutMs: NARRATION_CONFIG.networkProbeTimeoutMs,
      maxAttempts: NARRATION_CONFIG.networkProbeMaxAttempts,
      windowMs: NARRATION_CONFIG.networkProbeWindowMs,
    },
    // The one plain fetch in the app: /health is not an API route (conventions §12.1).
    { fetch: (url, init) => fetch(url, init), now: Date.now },
  );
  useNetworkStore.setState({ status: verdict });
  return verdict;
}
