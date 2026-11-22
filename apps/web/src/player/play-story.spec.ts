// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayerState } from './player';
import type { Track } from './track';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const track: Track = {
  placeId: 'p1',
  code: 'BT1',
  name: 'Nhà hát',
  categoryCode: 'LANDMARK',
  areaCode: null,
  photoUrl: null,
  lang: 'en',
  text: 'A story.',
  audio: null,
};
const state: PlayerState = {
  track,
  phase: 'paused',
  source: 'file',
  offline: false,
  elapsedMs: 4000,
  durationMs: null,
  rate: 1,
  upNext: null,
  nowPlayingOpen: false,
  transcriptOpen: false,
};
vi.mock('./use-player', () => ({ usePlayer: () => state }));
vi.mock('./player', () => ({ player: {} }));
vi.mock('../i18n/provider', () => ({
  useWeb: () => ({ t: (key: string) => key, tDynamic: (key: string) => key, locale: 'en' }),
}));

/** The browser's observer, each one told by the test whether its box is in view. */
const observers = vi.hoisted(() => {
  const all: { report: (inView: boolean) => void }[] = [];
  class FakeObserver {
    constructor(private readonly callback: (entries: { isIntersecting: boolean }[]) => void) {
      all.push({ report: (inView) => this.callback([{ isIntersecting: inView }]) });
    }
    observe() {}
    disconnect() {}
  }
  return { all, FakeObserver };
});
vi.stubGlobal('IntersectionObserver', observers.FakeObserver);

const { PlayStory } = await import('./play-story');
const { MiniPlayer } = await import('./surfaces');

const roots: Root[] = [];
function mount(element: Parameters<Root['render']>[0]): Root {
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  act(() => root.render(element));
  roots.push(root);
  return root;
}
const miniPlayer = () => document.querySelector('section[aria-label="player.nowPlaying"]');
const inline = () => createElement(PlayStory, { track, note: null, englishFallback: false });

describe('the mini player and the inline players (WQ2)', () => {
  afterEach(() => {
    for (const root of roots.splice(0)) act(() => root.unmount());
    observers.all.length = 0;
  });

  it('steps aside while an inline player of the playing Place is in view, and returns when it leaves', () => {
    mount(createElement(MiniPlayer));
    mount(inline());
    act(() => observers.all[0]!.report(true));
    expect(miniPlayer()).toBeNull();
    act(() => observers.all[0]!.report(false));
    expect(miniPlayer()).not.toBeNull();
  });

  it('stays aside when the page lays out anew: the old inline player leaves after the new one shows', () => {
    mount(createElement(MiniPlayer));
    const old = mount(inline());
    act(() => observers.all[0]!.report(true));
    // A narrower window: the Place's panel mounts again, in view, before the old one is gone.
    mount(inline());
    act(() => observers.all[1]!.report(true));
    act(() => old.unmount());
    expect(miniPlayer()).toBeNull();
  });

  it('stays aside once a sheet has slid in, without waiting for the observer’s next report', () => {
    mount(createElement(MiniPlayer));
    const sheet = mount(inline());
    // The sheet mounts below the viewport (its slide's first frame): the observer says so.
    act(() => observers.all[0]!.report(false));
    expect(miniPlayer()).not.toBeNull();
    // The slide ends with the box in view; the observer stays silent.
    const box = document.body.lastElementChild!.firstElementChild!;
    vi.spyOn(box, 'getBoundingClientRect').mockReturnValue({
      top: 596,
      bottom: 748,
      height: 152,
    } as DOMRect);
    act(() => {
      box.dispatchEvent(new Event('animationend', { bubbles: true }));
    });
    expect(miniPlayer()).toBeNull();
    act(() => sheet.unmount());
    expect(miniPlayer()).not.toBeNull();
  });
});
