import { NARRATION_CONFIG } from '@wayfare/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../env', () => ({ API_URL: 'https://api.test/api/v1' }));

const { checkNetwork, healthUrl, useNetworkStore } = await import('./network-store');

describe('the network verdict (ADR 0029)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks the API origin’s /health, outside the /api prefix', () => {
    expect(healthUrl).toBe('https://api.test/health');
  });

  it('is unknown until the first probe, then the gateway’s answer', async () => {
    expect(useNetworkStore.getState().status).toBe('unknown');
    const fetch = vi.fn(() => Promise.resolve({ status: 503 }));
    vi.stubGlobal('fetch', fetch);
    expect(await checkNetwork()).toBe('online');
    expect(fetch).toHaveBeenCalledWith('https://api.test/health', expect.anything());
    expect(useNetworkStore.getState().status).toBe('online');
  });

  it('is offline when no attempt answers within the limits', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error('unreachable')));
    vi.stubGlobal('fetch', fetch);
    expect(await checkNetwork()).toBe('offline');
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(NARRATION_CONFIG.networkProbeMaxAttempts);
    expect(useNetworkStore.getState().status).toBe('offline');
  });
});
