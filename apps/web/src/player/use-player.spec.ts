// @vitest-environment happy-dom
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '../testing/render-hook';

vi.mock('@wayfare/api-client', () => ({}));
vi.mock('../analytics/analytics', () => ({ narrationTracker: {} }));
vi.mock('../tours/progress', () => ({}));

const { usePlayer } = await import('./use-player');
const { player } = await import('./player');

describe('the player’s state, for a component', () => {
  it('re-renders on every change', async () => {
    const rendered = await renderHook(() => usePlayer());
    expect(rendered.current().nowPlayingOpen).toBe(false);
    act(() => player.setNowPlaying(true));
    expect(rendered.current().nowPlayingOpen).toBe(true);
  });
});
