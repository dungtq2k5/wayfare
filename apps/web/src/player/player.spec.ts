import { AnalyticsTrigger, AudioTier } from '@wayfare/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from './track';

const api = vi.hoisted(() => ({
  narrationOnDemand: vi.fn(),
  narrationStatus: vi.fn(),
  narrationStreamTicket: vi.fn(),
}));
vi.mock('@wayfare/api-client', () => api);
const tracker = vi.hoisted(() => ({
  begin: vi.fn((_placeId: string, _lang: string, _trigger: string) => undefined),
  end: vi.fn(),
  sounding: vi.fn(),
  silent: vi.fn(),
}));
vi.mock('../analytics/analytics', () => ({ narrationTracker: tracker }));
const progress = vi.hoisted(() => ({ recordFinished: vi.fn(() => Promise.resolve()) }));
vi.mock('../tours/progress', () => progress);
vi.mock('../env', () => ({ API_BASE_URL: 'https://api.test/api/v1' }));

const { NarrationPlayer, SPEEDS } = await import('./player');
const { markQrArrival } = await import('../analytics/qr-arrival');

/** The one `HTMLAudioElement`, as far as the player uses it. */
class FakeAudio {
  static last: FakeAudio | null = null;
  preload = '';
  playbackRate = 1;
  currentTime = 0;
  duration = Number.NaN;
  ended = false;
  src = '';
  /** What the next `play()` does: resolve, or reject with this. */
  refusal: Error | null = null;
  private readonly listeners = new Map<string, (() => void)[]>();
  constructor() {
    FakeAudio.last = this;
  }
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
  play(): Promise<void> {
    if (this.refusal !== null) return Promise.reject(this.refusal);
    this.emit('play');
    this.emit('playing');
    return Promise.resolve();
  }
  pause() {
    this.emit('pause');
  }
  removeAttribute(name: string) {
    if (name === 'src') this.src = '';
  }
  load() {}
}

class FakeUtterance {
  static last: FakeUtterance | null = null;
  lang = '';
  rate = 1;
  onstart: (() => void) | null = null;
  onresume: (() => void) | null = null;
  onpause: (() => void) | null = null;
  onend: (() => void) | null = null;
  constructor(readonly text: string) {
    FakeUtterance.last = this;
  }
}

const voices = { list: [{ lang: 'en-US' }] as { lang: string }[] };
const speech = {
  paused: false,
  getVoices: () => voices.list,
  speak: vi.fn(),
  cancel: vi.fn(),
  pause: vi.fn(() => {
    speech.paused = true;
  }),
  resume: vi.fn(() => {
    speech.paused = false;
  }),
};
const handlers = new Map<string, () => void>();
const browser = {
  onLine: true,
  mediaSession: {
    metadata: null as { title: string; artist: string; artwork: unknown[] } | null,
    playbackState: 'none',
    setActionHandler: (name: string, handler: () => void) => handlers.set(name, handler),
  },
};
const cached = new Set<string>();

const stored = { url: 'https://media.test/a.mp3', durationMs: 90_000 };
const track = (overrides: Partial<Track> = {}): Track => ({
  placeId: 'p1',
  code: 'P1',
  name: 'Bến Thành',
  categoryCode: 'MARKET',
  areaCode: 'd1',
  photoUrl: 'https://media.test/p1.jpg',
  lang: 'en',
  text: 'A market since 1914.',
  audio: stored,
  ...overrides,
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  FakeAudio.last = null;
  FakeUtterance.last = null;
  voices.list = [{ lang: 'en-US' }];
  speech.paused = false;
  browser.onLine = true;
  browser.mediaSession.metadata = null;
  handlers.clear();
  cached.clear();
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  vi.stubGlobal('speechSynthesis', speech);
  vi.stubGlobal('navigator', browser);
  vi.stubGlobal('caches', {
    match: (url: string) => Promise.resolve(cached.has(url) ? {} : undefined),
  });
  vi.stubGlobal(
    'MediaMetadata',
    class {
      constructor(init: object) {
        Object.assign(this, init);
      }
    },
  );
});

describe('the player’s ladder (K6)', () => {
  it('plays the stored file at once, and counts it as the Place’s own audio (T1)', async () => {
    const player = new NarrationPlayer();
    await player.play(track());
    expect(FakeAudio.last?.src).toBe(stored.url);
    expect(player.getState()).toMatchObject({
      phase: 'playing',
      source: 'file',
      durationMs: 90_000,
    });
    expect(tracker.begin).toHaveBeenCalledWith('p1', 'en', AnalyticsTrigger.TAP);
    expect(tracker.sounding).toHaveBeenCalledWith(AudioTier.T1);
  });

  it('shows the story being made, then plays what the server made on demand (T1_5)', async () => {
    api.narrationOnDemand.mockResolvedValue({ data: { status: 'READY', audio: stored } });
    const player = new NarrationPlayer();
    const phases: string[] = [];
    player.subscribe(() => phases.push(player.getState().phase));
    await player.play(track({ audio: null }));
    expect(phases).toContain('preparing');
    expect(player.getState()).toMatchObject({ phase: 'playing', source: 'file' });
    expect(tracker.sounding).toHaveBeenCalledWith(AudioTier.T1_5);
  });

  it('waits for an audio still being made, reading its status until it’s ready', async () => {
    api.narrationOnDemand.mockResolvedValue({ data: { status: 'PENDING', retryAfterMs: 1 } });
    api.narrationStatus.mockResolvedValue({ data: { audio: stored } });
    const player = new NarrationPlayer();
    await player.play(track({ audio: null }));
    expect(api.narrationStatus).toHaveBeenCalledWith('p1', { lang: 'en' });
    expect(player.getState().source).toBe('file');
  });

  it('reads it live when the wait for it runs out', async () => {
    vi.useFakeTimers();
    try {
      api.narrationOnDemand.mockResolvedValue({ data: { status: 'PENDING', retryAfterMs: 1_000 } });
      api.narrationStatus.mockResolvedValue({ data: { audio: null } });
      api.narrationStreamTicket.mockResolvedValue({ data: { ticket: 'tk1' } });
      const player = new NarrationPlayer();
      const playing = player.play(track({ audio: null }));
      await vi.advanceTimersByTimeAsync(10_000);
      await playing;
      expect(FakeAudio.last?.src).toBe('https://api.test/api/v1/narration/tts/stream/tk1');
      expect(player.getState()).toMatchObject({ source: 'stream', durationMs: null });
      expect(tracker.sounding).toHaveBeenCalledWith(AudioTier.T2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls to the live reading when making it on demand fails', async () => {
    api.narrationOnDemand.mockRejectedValue({ status: 503, code: 'UPSTREAM_UNAVAILABLE' });
    api.narrationStreamTicket.mockResolvedValue({ data: { ticket: 'tk2' } });
    const player = new NarrationPlayer();
    await player.play(track({ audio: null }));
    expect(player.getState().source).toBe('stream');
  });

  it('has the browser read it when nothing can be made, and rests at the end when it’s read', async () => {
    api.narrationOnDemand.mockResolvedValue({ data: { status: 'UNAVAILABLE' } });
    const player = new NarrationPlayer();
    await player.play(track({ audio: null }));
    const utterance = FakeUtterance.last!;
    expect(utterance).toMatchObject({ text: 'A market since 1914.', lang: 'en', rate: 1 });
    expect(speech.speak).toHaveBeenCalledWith(utterance);
    expect(player.getState()).toMatchObject({ phase: 'voice', source: 'voice', durationMs: null });
    utterance.onstart?.();
    expect(tracker.sounding).toHaveBeenCalledWith(AudioTier.T3);
    utterance.onpause?.();
    expect(tracker.silent).toHaveBeenCalled();
    utterance.onresume?.();
    utterance.onend?.();
    expect(progress.recordFinished).toHaveBeenCalledWith('p1');
    expect(tracker.end).toHaveBeenCalledWith(true);
    expect(player.getState().phase).toBe('paused');
  });

  it('says nothing can play it when the browser has no voice for its language', async () => {
    voices.list = [{ lang: 'vi-VN' }];
    api.narrationOnDemand.mockResolvedValue({ data: { status: 'UNAVAILABLE' } });
    const player = new NarrationPlayer();
    await player.play(track({ audio: null, lang: 'ja' }));
    expect(player.getState()).toMatchObject({ phase: 'unavailable', offline: false });
  });

  it('offline, plays a file the browser kept, and reads aloud one it didn’t', async () => {
    browser.onLine = false;
    cached.add(stored.url);
    const player = new NarrationPlayer();
    await player.play(track());
    expect(player.getState().source).toBe('file');
    cached.clear();
    await player.play(track());
    expect(player.getState()).toMatchObject({ source: 'voice', offline: true });
  });

  it('reads aloud when the live reading’s ticket fails, or says it can’t without a voice', async () => {
    api.narrationOnDemand.mockRejectedValue({ status: 500, code: 'INTERNAL' });
    api.narrationStreamTicket.mockRejectedValue(new Error('down'));
    const player = new NarrationPlayer();
    await player.play(track({ audio: null }));
    expect(player.getState().source).toBe('voice');
    voices.list = [];
    await player.play(track({ audio: null }));
    expect(player.getState().phase).toBe('unavailable');
  });

  it('drops a slow answer for a story the tourist already left', async () => {
    let answer: (value: unknown) => void = () => undefined;
    api.narrationOnDemand.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const player = new NarrationPlayer();
    const first = player.play(track({ audio: null, placeId: 'old' }));
    await player.play(track({ placeId: 'new' }));
    answer({
      data: { status: 'READY', audio: { url: 'https://media.test/old.mp3', durationMs: 1 } },
    });
    await first;
    expect(FakeAudio.last?.src).toBe(stored.url);
    expect(player.getState().track?.placeId).toBe('new');
  });

  it('counts a sticker page’s first story as entered by the QR, and the next by a tap', async () => {
    markQrArrival();
    const player = new NarrationPlayer();
    await player.play(track());
    await player.play(track());
    expect(tracker.begin.mock.calls.map((call) => call[2])).toEqual([
      AnalyticsTrigger.QR,
      AnalyticsTrigger.TAP,
    ]);
  });
});

describe('the browser’s refusals (WN4b)', () => {
  const refuse = async (name: string) => {
    const player = new NarrationPlayer();
    await player.play(track());
    FakeAudio.last!.refusal = new DOMException('no', name);
    await player.play(track());
    return player.getState().phase;
  };

  it('holds the story until a tap when sound needs one', async () => {
    expect(await refuse('NotAllowedError')).toBe('held');
  });

  it('ignores a play cut short by the next one', async () => {
    expect(await refuse('AbortError')).toBe('paused');
  });

  it('says nothing can play it on any other failure', async () => {
    expect(await refuse('NotSupportedError')).toBe('unavailable');
  });

  it('reads it live, once, when the file fails while playing', async () => {
    api.narrationStreamTicket.mockResolvedValue({ data: { ticket: 'tk3' } });
    const player = new NarrationPlayer();
    await player.play(track());
    FakeAudio.last!.emit('error');
    await flush();
    expect(player.getState().source).toBe('stream');
    FakeAudio.last!.emit('error');
    await flush();
    expect(api.narrationStreamTicket).toHaveBeenCalledTimes(1);
  });
});

describe('the controls', () => {
  it('follows the element’s time and length, and counts silence while it waits', async () => {
    const player = new NarrationPlayer();
    await player.play(track());
    const audio = FakeAudio.last!;
    audio.currentTime = 12.5;
    audio.emit('timeupdate');
    audio.duration = 95;
    audio.emit('durationchange');
    audio.duration = Number.POSITIVE_INFINITY;
    audio.emit('durationchange');
    audio.emit('waiting');
    expect(player.getState()).toMatchObject({ elapsedMs: 12_500, durationMs: 95_000 });
    expect(tracker.silent).toHaveBeenCalled();
  });

  it('pauses and plays again; a story played to its end starts over', async () => {
    const player = new NarrationPlayer();
    await player.play(track());
    player.toggle();
    expect(player.getState().phase).toBe('paused');
    const audio = FakeAudio.last!;
    audio.ended = true;
    audio.currentTime = 90;
    player.toggle();
    await flush();
    expect(audio.currentTime).toBe(0);
    expect(player.getState().phase).toBe('playing');
  });

  it('plays the story from the start when nothing is loaded', async () => {
    const player = new NarrationPlayer();
    player.toggle();
    await player.play(track());
    player.stop();
    player.toggle();
    expect(player.getState().track).toBeNull();
  });

  it('pauses and resumes the browser’s voice', () => {
    const player = new NarrationPlayer();
    player.readAloud(track());
    expect(player.getState().phase).toBe('voice');
    player.toggle();
    expect(speech.pause).toHaveBeenCalled();
    expect(player.getState().phase).toBe('paused');
    player.toggle();
    expect(speech.resume).toHaveBeenCalled();
    expect(player.getState().phase).toBe('voice');
  });

  it('goes back ten seconds, never before the start; a voice can’t go back', async () => {
    const player = new NarrationPlayer();
    player.back10();
    await player.play(track());
    const audio = FakeAudio.last!;
    audio.currentTime = 25;
    player.back10();
    expect(audio.currentTime).toBe(15);
    player.back10();
    player.back10();
    expect(audio.currentTime).toBe(0);
    player.readAloud(track());
    audio.currentTime = 30;
    player.back10();
    expect(audio.currentTime).toBe(30);
  });

  it('moves within a recording only, never ahead of a live reading', async () => {
    api.narrationOnDemand.mockRejectedValue({ status: 500, code: 'INTERNAL' });
    api.narrationStreamTicket.mockResolvedValue({ data: { ticket: 'tk4' } });
    const player = new NarrationPlayer();
    player.seek(1_000);
    await player.play(track());
    player.seek(42_000);
    expect(FakeAudio.last!.currentTime).toBe(42);
    player.seek(-5);
    expect(FakeAudio.last!.currentTime).toBe(0);
    await player.play(track({ audio: null }));
    player.seek(10_000);
    expect(FakeAudio.last!.currentTime).toBe(0);
  });

  it('replays a recording from the start, and a voice from its first word', async () => {
    const player = new NarrationPlayer();
    player.replay();
    await player.play(track());
    FakeAudio.last!.currentTime = 50;
    player.replay();
    expect(FakeAudio.last!.currentTime).toBe(0);
    player.readAloud(track());
    const first = FakeUtterance.last;
    player.replay();
    expect(FakeUtterance.last).not.toBe(first);
  });

  it('moves through the speeds in the pill’s order, the element following', async () => {
    const player = new NarrationPlayer();
    player.cycleSpeed();
    await player.play(track());
    const seen = [player.getState().rate];
    for (let i = 0; i < SPEEDS.length; i++) {
      player.cycleSpeed();
      seen.push(player.getState().rate);
    }
    expect(seen).toEqual([1.25, 1.5, 0.75, 1, 1.25]);
    expect(FakeAudio.last!.playbackRate).toBe(1.25);
  });

  it('closes on stop, keeping the speed and the waiting story', async () => {
    const player = new NarrationPlayer();
    await player.play(track());
    player.queue(track({ placeId: 'p2' }));
    player.cycleSpeed();
    player.stop();
    expect(tracker.end).toHaveBeenCalledWith(false);
    expect(player.getState()).toMatchObject({
      track: null,
      phase: 'idle',
      rate: 1.25,
      upNext: { placeId: 'p2' },
    });
  });

  it('a voice stopped mid-sentence never counts as finished', () => {
    const player = new NarrationPlayer();
    player.readAloud(track());
    const utterance = FakeUtterance.last!;
    player.stop();
    utterance.onend?.();
    expect(progress.recordFinished).not.toHaveBeenCalled();
    expect(speech.cancel).toHaveBeenCalled();
  });

  it('says it can’t read aloud in a browser with no speech', () => {
    vi.stubGlobal('speechSynthesis', undefined);
    const player = new NarrationPlayer();
    player.readAloud(track());
    expect(player.getState().phase).toBe('unavailable');
  });
});

describe('play next (round 26)', () => {
  it('plays a story at once when nothing plays, else keeps it waiting', async () => {
    const player = new NarrationPlayer();
    player.queue(track());
    await flush();
    expect(player.getState().track?.placeId).toBe('p1');
    player.queue(track({ placeId: 'p2' }));
    expect(player.getState().upNext?.placeId).toBe('p2');
  });

  it('starts the waiting story when the current one ends', async () => {
    const player = new NarrationPlayer();
    await player.play(track());
    player.queue(track({ placeId: 'p2' }));
    FakeAudio.last!.emit('ended');
    await flush();
    expect(progress.recordFinished).toHaveBeenCalledWith('p1');
    expect(player.getState()).toMatchObject({ track: { placeId: 'p2' }, upNext: null });
  });

  it('rests at the end when nothing waits', async () => {
    const player = new NarrationPlayer();
    await player.play(track());
    FakeAudio.last!.emit('ended');
    expect(player.getState()).toMatchObject({ phase: 'paused', elapsedMs: 90_000 });
  });

  it('skips to the waiting story; with none, skipping does nothing', async () => {
    const player = new NarrationPlayer();
    player.skip();
    await player.play(track());
    player.queue(track({ placeId: 'p2' }));
    player.skip();
    await flush();
    expect(player.getState().track?.placeId).toBe('p2');
  });

  it('opens Now playing or the transcript, never both', () => {
    const player = new NarrationPlayer();
    player.setTranscript(true);
    player.setNowPlaying(true);
    expect(player.getState()).toMatchObject({ nowPlayingOpen: true, transcriptOpen: false });
    player.setTranscript(true);
    expect(player.getState()).toMatchObject({ nowPlayingOpen: false, transcriptOpen: true });
    player.setNowPlaying(false);
    player.setTranscript(false);
    expect(player.getState()).toMatchObject({ nowPlayingOpen: false, transcriptOpen: false });
  });
});

describe('the lock screen (WN5)', () => {
  it('names the story and its area, and follows play and pause', async () => {
    const player = new NarrationPlayer();
    player.areaName = () => 'District 1';
    await player.play(track());
    expect(browser.mediaSession.metadata).toMatchObject({
      title: 'Bến Thành',
      artist: 'District 1',
      artwork: [{ src: 'https://media.test/p1.jpg' }],
    });
    expect(browser.mediaSession.playbackState).toBe('playing');
    handlers.get('pause')?.();
    expect(browser.mediaSession.playbackState).toBe('paused');
    FakeAudio.last!.currentTime = 20;
    handlers.get('seekbackward')?.();
    expect(FakeAudio.last!.currentTime).toBe(10);
    handlers.get('play')?.();
    await flush();
    expect(browser.mediaSession.playbackState).toBe('playing');
  });

  it('shows no artwork for a Place with no photo, and clears the card on stop', async () => {
    const player = new NarrationPlayer();
    await player.play(track({ photoUrl: null }));
    expect(browser.mediaSession.metadata?.artwork).toEqual([]);
    player.stop();
    expect(browser.mediaSession.metadata).toBeNull();
  });
});
