'use client';

import { narrationOnDemand, narrationStatus, narrationStreamTicket } from '@wayfare/api-client';
import { NARRATION_CONFIG } from '@wayfare/contracts';
import { API_BASE_URL } from '../env';
import { recordFinished } from '../tours/progress';
import { resolveSource } from './ladder';
import type { OnDemandAnswer, StoredAudio } from './ladder';
import type { Track } from './track';

/**
 * Where the player is (K6, the handoff's WN):
 * - `preparing`: the story is being made (WN3);
 * - `playing` / `paused`: the recording or the live reading (WN3b) plays or rests;
 * - `held`: the browser refused `play()` until a tap (WN4b);
 * - `voice`: the browser's own voice reads it (WN3c);
 * - `unavailable`: nothing can play it now (WN4).
 */
export type Phase = 'idle' | 'preparing' | 'playing' | 'paused' | 'held' | 'voice' | 'unavailable';

export interface PlayerState {
  readonly track: Track | null;
  readonly phase: Phase;
  /** What is playing: the stored file, the live reading, or the browser's voice. */
  readonly source: 'file' | 'stream' | 'voice' | null;
  /** Unavailable because offline (WN4), not because nothing exists. */
  readonly offline: boolean;
  readonly elapsedMs: number;
  readonly durationMs: number | null;
  readonly rate: number;
  /** The single waiting story, filled only by the tourist (round 26). */
  readonly upNext: Track | null;
  readonly nowPlayingOpen: boolean;
  readonly transcriptOpen: boolean;
}

const IDLE: PlayerState = {
  track: null,
  phase: 'idle',
  source: null,
  offline: false,
  elapsedMs: 0,
  durationMs: null,
  rate: 1,
  upNext: null,
  nowPlayingOpen: false,
  transcriptOpen: false,
};

/** The speeds the pill moves through. */
export const SPEEDS = [1, 1.25, 1.5, 0.75] as const;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Whether the browser can read `lang` aloud (WN3c), from its own voices. */
function hasVoiceFor(lang: string): boolean {
  if (typeof speechSynthesis === 'undefined') return false;
  const primary = lang.toLowerCase().split('-')[0];
  return speechSynthesis.getVoices().some((voice) => voice.lang.toLowerCase().startsWith(primary!));
}

async function isCached(url: string): Promise<boolean> {
  try {
    return typeof caches !== 'undefined' && (await caches.match(url)) !== undefined;
  } catch {
    return false;
  }
}

/**
 * The web's one player (K6): one `HTMLAudioElement` for the file and the live reading, the
 * browser's `speechSynthesis` for the last resort. Nothing plays before a tap. Its state is an
 * external store React reads with `useSyncExternalStore`.
 */
export class NarrationPlayer {
  private state: PlayerState = IDLE;
  private readonly listeners = new Set<() => void>();
  private audio: HTMLAudioElement | null = null;
  private generation = 0;
  private utterance: SpeechSynthesisUtterance | null = null;

  getState = (): PlayerState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(next: Partial<PlayerState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
    this.syncMediaSession();
  }

  private element(): HTMLAudioElement {
    if (this.audio !== null) return this.audio;
    const audio = new Audio();
    audio.preload = 'auto';
    audio.addEventListener('timeupdate', () => this.set({ elapsedMs: audio.currentTime * 1000 }));
    audio.addEventListener('durationchange', () => {
      if (Number.isFinite(audio.duration)) this.set({ durationMs: audio.duration * 1000 });
    });
    audio.addEventListener('play', () => this.set({ phase: 'playing' }));
    audio.addEventListener('pause', () => {
      if (this.state.phase === 'playing') this.set({ phase: 'paused' });
    });
    audio.addEventListener('ended', () => this.finished());
    audio.addEventListener('error', () => {
      // The file failed while playing: read it live instead, once.
      if (this.state.source === 'file' && this.state.track !== null && navigator.onLine) {
        void this.startStream(this.state.track, this.generation);
      }
    });
    this.audio = audio;
    return audio;
  }

  /** Plays a story from the start, as the ladder finds it (K6). */
  async play(track: Track): Promise<void> {
    const generation = ++this.generation;
    this.stopSound();
    this.set({
      track,
      phase: track.audio === null ? 'preparing' : 'paused',
      source: null,
      offline: false,
      elapsedMs: 0,
      durationMs: track.audio?.durationMs ?? null,
    });
    const audio = this.element();
    const resolution = await resolveSource(track.audio, {
      stale: () => generation !== this.generation,
      isOffline: () => !navigator.onLine,
      isCached,
      onDemand: async (): Promise<OnDemandAnswer> => {
        const { data } = await narrationOnDemand({ placeId: track.placeId, lang: track.lang });
        if (data.status === 'READY')
          return {
            status: 'READY',
            audio: { url: data.audio.url, durationMs: data.audio.durationMs },
          };
        if (data.status === 'PENDING')
          return { status: 'PENDING', retryAfterMs: data.retryAfterMs };
        return { status: 'UNAVAILABLE' };
      },
      status: async (): Promise<StoredAudio | null> => {
        const { data } = await narrationStatus(track.placeId, { lang: track.lang });
        return data.audio === null
          ? null
          : { url: data.audio.url, durationMs: data.audio.durationMs };
      },
      hasVoice: () => hasVoiceFor(track.lang),
      sleep,
      now: () => Date.now(),
      onDemandWaitMs: NARRATION_CONFIG.onDemandWaitMs,
      onPreparing: () => this.set({ phase: 'preparing' }),
    });
    if (generation !== this.generation) return;
    switch (resolution.kind) {
      case 'file':
        audio.src = resolution.audio.url;
        this.set({ source: 'file', durationMs: resolution.audio.durationMs });
        return this.start(audio);
      case 'stream':
        return this.startStream(track, generation);
      case 'voice':
        return this.speak(track, resolution.offline);
      case 'unavailable':
        this.set({ phase: 'unavailable', offline: !navigator.onLine });
        return;
      case 'discarded':
        return;
    }
  }

  /** WN3b: the live reading by a stream ticket — an `<audio src>` can carry no header (K21). */
  private async startStream(track: Track, generation: number): Promise<void> {
    try {
      const { data } = await narrationStreamTicket({ placeId: track.placeId, lang: track.lang });
      if (generation !== this.generation) return;
      const audio = this.element();
      audio.src = `${API_BASE_URL}/narration/tts/stream/${data.ticket}`;
      this.set({ source: 'stream', durationMs: null });
      await this.start(audio);
    } catch {
      if (generation !== this.generation) return;
      if (hasVoiceFor(track.lang)) return this.speak(track, !navigator.onLine);
      this.set({ phase: 'unavailable', offline: !navigator.onLine });
    }
  }

  private async start(audio: HTMLAudioElement): Promise<void> {
    audio.playbackRate = this.state.rate;
    try {
      await audio.play();
    } catch (error) {
      // WN4b: the browser holds sound back until a tap; the next tap plays.
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        this.set({ phase: 'held' });
        return;
      }
      if (error instanceof DOMException && error.name === 'AbortError') return;
      this.set({ phase: 'unavailable', offline: !navigator.onLine });
    }
  }

  /** WQ3's offer: the browser reads the shown text aloud, at once, whatever audio exists. */
  readAloud(track: Track): void {
    ++this.generation;
    this.stopSound();
    this.set({ track, elapsedMs: 0 });
    this.speak(track, !navigator.onLine);
  }

  /** WN3c: the browser's own voice, said honestly, with no scrubber. */
  private speak(track: Track, offline: boolean): void {
    if (typeof speechSynthesis === 'undefined') {
      this.set({ phase: 'unavailable', offline });
      return;
    }
    const utterance = new SpeechSynthesisUtterance(track.text);
    utterance.lang = track.lang;
    utterance.rate = this.state.rate;
    utterance.onend = () => {
      if (this.utterance === utterance) this.finished();
    };
    this.utterance = utterance;
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
    this.set({ phase: 'voice', source: 'voice', offline, durationMs: null });
  }

  private stopSound(): void {
    if (this.audio !== null) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
    }
    if (this.utterance !== null && typeof speechSynthesis !== 'undefined') {
      this.utterance = null;
      speechSynthesis.cancel();
    }
  }

  /** The story ended: the next one waiting starts, else the player rests at the end. */
  private finished(): void {
    // Played to its end: a tour's progress counts it (round 39's K8).
    if (this.state.track !== null) void recordFinished(this.state.track.placeId);
    const next = this.state.upNext;
    if (next !== null) {
      this.set({ upNext: null });
      void this.play(next);
      return;
    }
    this.set({ phase: 'paused', elapsedMs: this.state.durationMs ?? this.state.elapsedMs });
  }

  /** Play or pause; a held or rested story plays from where it is. */
  toggle(): void {
    const { phase, source, track } = this.state;
    if (source === 'voice') {
      if (speechSynthesis.paused) {
        speechSynthesis.resume();
        this.set({ phase: 'voice' });
      } else {
        speechSynthesis.pause();
        this.set({ phase: 'paused' });
      }
      return;
    }
    const audio = this.audio;
    if (phase === 'playing') {
      audio?.pause();
      return;
    }
    if (audio === null || audio.src === '') {
      if (track !== null) void this.play(track);
      return;
    }
    if (audio.ended) audio.currentTime = 0;
    void this.start(audio);
  }

  back10(): void {
    if (this.audio !== null && this.state.source !== 'voice')
      this.audio.currentTime = Math.max(0, this.audio.currentTime - 10);
  }

  /** Moves within a recording; a live reading can't seek ahead of what was read (WN3b). */
  seek(ms: number): void {
    if (this.audio === null || this.state.source !== 'file') return;
    this.audio.currentTime = Math.max(0, ms / 1000);
  }

  replay(): void {
    if (this.state.source === 'voice' && this.state.track !== null) {
      this.speak(this.state.track, this.state.offline);
      return;
    }
    if (this.audio !== null) {
      this.audio.currentTime = 0;
      void this.start(this.audio);
    }
  }

  cycleSpeed(): void {
    const index = SPEEDS.indexOf(this.state.rate as (typeof SPEEDS)[number]);
    const rate = SPEEDS[(index + 1) % SPEEDS.length]!;
    if (this.audio !== null) this.audio.playbackRate = rate;
    this.set({ rate });
  }

  /** Cancel preparing, or stop: the player closes. */
  stop(): void {
    this.generation++;
    this.stopSound();
    this.state = { ...IDLE, rate: this.state.rate, upNext: this.state.upNext };
    this.set({});
  }

  /** *Play next*: the one waiting slot (round 26). */
  queue(track: Track): void {
    if (this.state.track === null) {
      void this.play(track);
      return;
    }
    this.set({ upNext: track });
  }

  /** *Play now* on the waiting story: skip to it. */
  skip(): void {
    const next = this.state.upNext;
    if (next === null) return;
    this.set({ upNext: null });
    void this.play(next);
  }

  setNowPlaying(open: boolean): void {
    this.set({ nowPlayingOpen: open, transcriptOpen: open ? false : this.state.transcriptOpen });
  }

  setTranscript(open: boolean): void {
    this.set({ transcriptOpen: open, nowPlayingOpen: open ? false : this.state.nowPlayingOpen });
  }

  /** WN5: the lock screen's card and controls, while the tab is open. */
  private mediaSessionReady = false;
  private syncMediaSession(): void {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const { track, phase } = this.state;
    if (!this.mediaSessionReady) {
      this.mediaSessionReady = true;
      navigator.mediaSession.setActionHandler('play', () => this.toggle());
      navigator.mediaSession.setActionHandler('pause', () => this.toggle());
      navigator.mediaSession.setActionHandler('seekbackward', () => this.back10());
    }
    if (track === null) {
      navigator.mediaSession.metadata = null;
      return;
    }
    if (navigator.mediaSession.metadata?.title !== track.name) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.name,
        artist: this.areaName(track),
        artwork: track.photoUrl === null ? [] : [{ src: track.photoUrl }],
      });
    }
    navigator.mediaSession.playbackState =
      phase === 'playing' || phase === 'voice' ? 'playing' : 'paused';
  }

  /** The area's name for the lock screen, given by the page that knows the language. */
  areaName: (track: Track) => string = () => '';
}

/** The page's one player. */
export const player = new NarrationPlayer();
