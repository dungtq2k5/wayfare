import type { AnalyticsClient, AnalyticsSnapshot } from '@wayfare/core';
import { useEffect, useState } from 'react';
import { analytics } from './analytics';

/** The client and its latest snapshot, for a screen; null until it's open. */
export function useAnalytics(): { client: AnalyticsClient; snapshot: AnalyticsSnapshot } | null {
  const [state, setState] = useState<{
    client: AnalyticsClient;
    snapshot: AnalyticsSnapshot;
  } | null>(null);
  useEffect(() => {
    let stop: (() => void) | null = null;
    let live = true;
    void analytics().then((client) => {
      if (!live) return;
      setState({ client, snapshot: client.snapshot() });
      stop = client.subscribe((snapshot) => setState({ client, snapshot }));
    });
    return () => {
      live = false;
      stop?.();
    };
  }, []);
  return state;
}
