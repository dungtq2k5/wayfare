// Renders a hook in a happy-dom document, for a spec that declares `@vitest-environment happy-dom`.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Rendered<T> {
  /** The hook's latest answer. */
  readonly current: () => T;
  readonly queries: QueryClient;
  unmount(): void;
}

/** Mounts `hook` inside a fresh query client; `current()` reads its latest answer. */
export async function renderHook<T>(hook: () => T): Promise<Rendered<T>> {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let latest: T;
  function Probe(): ReactNode {
    latest = hook();
    return null;
  }
  const root = createRoot(document.createElement('div'));
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: queries }, createElement(Probe)));
    await Promise.resolve();
  });
  return {
    current: () => latest,
    queries,
    unmount: () => act(() => root.unmount()),
  };
}

/** Lets pending promises, React Query's batched notices and React's updates settle. */
export async function settle(): Promise<void> {
  for (let tick = 0; tick < 3; tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}
