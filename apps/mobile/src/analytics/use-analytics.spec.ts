// @vitest-environment happy-dom
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook, settle } from '../testing/render-hook';

/** A client whose snapshots the test pushes. */
const client = vi.hoisted(() => {
  const listeners = new Set<(snapshot: object) => void>();
  return {
    snapshot: () => ({ consent: 'UNKNOWN' }),
    subscribe: (listener: (snapshot: object) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    push: (snapshot: object) => listeners.forEach((listener) => listener(snapshot)),
    listeners,
  };
});
const opening = vi.hoisted(() => ({ analytics: vi.fn(() => Promise.resolve(client)) }));
vi.mock('./analytics', () => opening);

const { useAnalytics } = await import('./use-analytics');

describe('the analytics client, for a screen', () => {
  it('is null until open, then follows each snapshot, and stops when unmounted', async () => {
    const rendered = await renderHook(() => useAnalytics());
    await settle();
    expect(rendered.current()?.snapshot).toEqual({ consent: 'UNKNOWN' });
    act(() => client.push({ consent: 'GRANTED' }));
    expect(rendered.current()?.snapshot).toEqual({ consent: 'GRANTED' });
    rendered.unmount();
    expect(client.listeners.size).toBe(0);
  });

  it('ignores a client that opens after the screen left', async () => {
    let open: (value: typeof client) => void = () => undefined;
    opening.analytics.mockReturnValueOnce(new Promise((resolve) => (open = resolve)));
    const rendered = await renderHook(() => useAnalytics());
    rendered.unmount();
    open(client);
    await settle();
    expect(client.listeners.size).toBe(0);
  });
});
