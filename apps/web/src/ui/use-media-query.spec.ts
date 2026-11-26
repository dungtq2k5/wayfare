// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { renderHook, settle } from '@wayfare/ui/testing';
import { DESK, TABLET, useMediaQuery } from './use-media-query';

/** A media query list the test flips. */
function fakeMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  const list = {
    get matches() {
      return matches;
    },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal('matchMedia', () => list);
  return {
    flip(next: boolean) {
      matches = next;
      for (const listener of listeners) listener();
    },
    listeners,
  };
}

describe('useMediaQuery (the handoff’s widths)', () => {
  it('names the tablet and desk widths', () => {
    expect([TABLET, DESK]).toEqual(['(min-width: 45rem)', '(min-width: 75rem)']);
  });

  it('follows the window as it crosses the width, and stops listening when unmounted', async () => {
    const media = fakeMatchMedia(false);
    const rendered = await renderHook(() => useMediaQuery(TABLET));
    expect(rendered.current()).toBe(false);
    media.flip(true);
    await settle();
    expect(rendered.current()).toBe(true);
    rendered.unmount();
    expect(media.listeners.size).toBe(0);
  });
});
