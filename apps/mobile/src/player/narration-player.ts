import { getNarrationStreamUrl, narrationOnDemand, narrationStatus } from '@wayfare/api-client';
import { APP_VERSION_HEADER, CLIENT_HEADER, NARRATION_CONFIG } from '@wayfare/contracts';
import type { Language } from '@wayfare/contracts';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer, AudioStatus } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { onBecomingNoisy } from '../../modules/noisy-audio/src';
import { APP_VERSION } from '../api';
import { API_URL } from '../env';
import { useNetworkStore } from '../network/network-store';
import { deviceSession } from '../session';
import { PLAYBACK_SPEEDS, useAppStore } from '../state/app-store';
import { areaNameOf } from './area-name';
import { fallbackArtworkUrl } from './fallback-artwork';
import { cachedFile, downloadToCache } from './audio-cache';
import { resolveSource } from './ladder';
import type { LadderDeps, OnDemandAnswer, Resolution, Rung } from './ladder';
import { nextPause } from './pause-machine';
import { afterManualPlay, decideOffer } from './queue';
import type { OfferResult } from './queue';
import { engineLocale, hasVoiceFor, splitSentences } from './speech-text';
import { usePlayerStore } from './store';
import type { Narration, PauseReason, PlayerNotice, PlayerPlace, SourceKind } from './types';

const RING_MS = 2_000;
const SWITCHED_MS = 4_000;
const UNAVAILABLE_MS = 6_000;
/** A source that has not begun to play by now has failed (a stream that never connects). */
const START_TIMEOUT_MS = 15_000;

const currentLang = (): Language => useAppStore.getState().language ?? 'en';

const deps: LadderDeps = {
  currentLang,
  isOffline: () => useNetworkStore.getState().status === 'offline',
  onDemand: async (placeId, lang): Promise<OnDemandAnswer> => {
    const { data } = await narrationOnDemand({ placeId, lang });
    if (data.status === 'READY') return { status: 'READY', audio: data.audio };
    if (data.status === 'PENDING') return { status: 'PENDING', retryAfterMs: data.retryAfterMs };
    return { status: 'UNAVAILABLE' };
  },
  status: async (placeId, lang) => (await narrationStatus(placeId, { lang })).data.audio ?? null,
  cachedFile,
  download: downloadToCache,
  hasDeviceVoice: async (lang) => {
    const voices = await Speech.getAvailableVoicesAsync();
    return hasVoiceFor(
      voices.map((voice) => voice.language),
      lang,
    );
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: Date.now,
  onDemandWaitMs: NARRATION_CONFIG.onDemandWaitMs,
};

/**
 * The one player (conventions §12.3): it owns playback, audio focus, the source ladder and the
 * queue, and nothing else in the app calls an audio or speech API. Its state lives in
 * `usePlayerStore`, which every player screen renders.
 */
class NarrationPlayer {
  private audio: AudioPlayer | null = null;
  private subscriptions: { remove: () => void }[] = [];
  /** Bumped whenever a narration begins or ends: a late answer for an old one is dropped. */
  private sequence = 0;
  private everPlayed = false;
  /** Whether the current source is in Android's media notification yet. */
  private inNotification = false;
  private startTimer: ReturnType<typeof setTimeout> | undefined;
  private ringTimer: ReturnType<typeof setTimeout> | undefined;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  private sentences: string[] = [];
  private sentenceIndex = 0;
  private modeReady = false;
  private stopListeningNoisy: (() => void) | null = null;

  // ——— what callers use ———

  /** A manual *Play narration*: the tap wins; *Up next* is left as it was. */
  play(place: PlayerPlace): void {
    const { current, next } = usePlayerStore.getState();
    const waiting = afterManualPlay({ currentId: current?.place.id ?? null, next }, place);
    this.begin(place, 'manual', null, waiting);
  }

  /** What the walk calls: start, wait in *Up next*, or refuse; told which. */
  offer(place: PlayerPlace, options: { distanceM?: number } = {}): OfferResult {
    const { current, next } = usePlayerStore.getState();
    const result = decideOffer({ currentId: current?.place.id ?? null, next }, place);
    if (result === 'start') this.begin(place, 'auto', options.distanceM ?? null, next);
    else if (result === 'queued') usePlayerStore.setState({ next: place });
    return result;
  }

  pause(): void {
    this.setPause({ type: 'user-pause' });
    clearTimeout(this.startTimer);
    this.halt();
  }

  resume(): void {
    this.setPause({ type: 'user-resume' });
    const source = usePlayerStore.getState().current?.source;
    if ((source === 'file' || source === 'stream') && !this.everPlayed) {
      this.armStartTimer(this.sequence, source);
    }
    this.carryOn();
  }

  togglePause(): void {
    const current = usePlayerStore.getState().current;
    if (current === null || current.source === null) return;
    if (current.paused === null) this.pause();
    else this.resume();
  }

  /** Plays *Up next*, or stops when nothing waits. */
  skip(): void {
    const { next } = usePlayerStore.getState();
    if (next === null) this.stop();
    else this.begin(next, 'manual', null, null);
  }

  stop(): void {
    this.sequence += 1;
    this.teardown();
    this.clearTimers();
    usePlayerStore.setState({ current: null });
  }

  /** From the start: the file seeks to 0, the voice starts its text again. */
  replay(): void {
    const current = usePlayerStore.getState().current;
    if (current === null || current.source === null) return;
    this.setPause({ type: 'user-resume' });
    if (current.source === 'device') {
      void Speech.stop();
      this.sentenceIndex = 0;
      this.speakFrom(this.sequence);
    } else if (this.audio !== null) {
      void this.audio.seekTo(0);
      this.audio.play();
    }
  }

  seek(positionMs: number): void {
    if (this.audio === null || usePlayerStore.getState().current?.source !== 'file') return;
    void this.audio.seekTo(positionMs / 1000);
  }

  cycleSpeed(): void {
    const now = useAppStore.getState().playbackSpeed;
    const speed = PLAYBACK_SPEEDS[(PLAYBACK_SPEEDS.indexOf(now) + 1) % PLAYBACK_SPEEDS.length] ?? 1;
    useAppStore.getState().setPlaybackSpeed(speed);
    this.audio?.setPlaybackRate(speed);
  }

  closeNotice(): void {
    clearTimeout(this.noticeTimer);
    usePlayerStore.setState({ notice: null });
  }

  /** The Place sheet tells the player what it shows, so the mini player can step aside. */
  setSheet(placeId: string | null, peek: boolean, height = 0): void {
    usePlayerStore.setState({ sheet: { placeId, peek, height } });
  }

  // ——— starting ———

  private begin(
    place: PlayerPlace,
    started: Narration['started'],
    distanceM: number | null,
    next: PlayerPlace | null,
  ): void {
    this.teardown();
    this.clearTimers();
    const token = (this.sequence += 1);
    const lang = currentLang();
    usePlayerStore.setState({
      current: {
        place,
        lang,
        source: null,
        paused: null,
        started,
        distanceM,
        ring: started === 'auto',
        positionMs: null,
        durationMs: place.audio?.durationMs ?? null,
      },
      next,
      notice: null,
    });
    if (started === 'auto') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
      this.ringTimer = setTimeout(() => this.patch({ ring: false }), RING_MS);
    }
    void this.run(token, 'file', false);
  }

  private async run(token: number, rung: Rung, fellBack: boolean): Promise<void> {
    const narration = usePlayerStore.getState().current;
    if (narration === null) return;
    let resolution: Resolution;
    try {
      resolution = await resolveSource(narration.place, narration.lang, rung, deps, fellBack);
    } catch {
      resolution = { kind: 'unavailable' };
    }
    if (token !== this.sequence) return;
    switch (resolution.kind) {
      case 'discarded':
        this.stop();
        return;
      case 'unavailable':
        this.unavailable(narration);
        return;
      case 'file':
        await this.startFile(token, resolution.uri, resolution.fellBack);
        return;
      case 'stream':
        await this.startStream(token, resolution.fellBack);
        return;
      case 'device':
        this.startDevice(token, resolution.fellBack);
        return;
    }
  }

  private unavailable(narration: Narration): void {
    const manual = narration.started === 'manual';
    this.sequence += 1;
    this.teardown();
    this.clearTimers();
    usePlayerStore.setState({ current: null });
    // An auto offer for a Place with nothing to play is skipped silently; *Up next* carries on.
    if (manual) this.showNotice({ kind: 'unavailable', place: narration.place }, UNAVAILABLE_MS);
    else this.advance();
  }

  private async startFile(token: number, uri: string, fellBack: boolean): Promise<void> {
    await this.prepareAudio();
    if (token !== this.sequence) return;
    this.attach(token, { uri }, 'file', fellBack);
  }

  private async startStream(token: number, fellBack: boolean): Promise<void> {
    await this.prepareAudio();
    const narration = usePlayerStore.getState().current;
    if (token !== this.sequence || narration === null) return;
    const bearer = await deviceSession.accessToken().catch(() => null);
    if (token !== this.sequence) return;
    const path = getNarrationStreamUrl({ placeId: narration.place.id, lang: narration.lang });
    this.attach(
      token,
      {
        uri: `${API_URL}${path}`,
        headers: {
          [CLIENT_HEADER]: 'mobile',
          [APP_VERSION_HEADER]: APP_VERSION,
          ...(bearer === null ? {} : { authorization: `Bearer ${bearer}` }),
        },
      },
      'stream',
      fellBack,
    );
  }

  private attach(
    token: number,
    source: { uri: string; headers?: Record<string, string> },
    kind: 'file' | 'stream',
    fellBack: boolean,
  ): void {
    const narration = usePlayerStore.getState().current;
    if (narration === null) return;
    // Never two at once: whatever was playing goes before this starts.
    this.teardownAudio();
    void Speech.stop();
    const player = createAudioPlayer(source, { updateInterval: 250 });
    this.audio = player;
    this.everPlayed = false;
    this.inNotification = false;
    this.subscriptions.push(
      player.addListener('playbackStatusUpdate', (status) => this.onStatus(token, kind, status)),
    );
    player.setPlaybackRate(useAppStore.getState().playbackSpeed);
    // A source swapped in after a failure keeps a pause the tourist already asked for.
    if (narration.paused !== 'user' && narration.paused !== 'headphones') player.play();
    // The state first: whatever the notification does, the screens must know a source is playing.
    this.patch({ source: kind });
    // A file waits for its length (onStatus): a media card posted before it knows the duration
    // never gets its slider on some phones (HyperOS), even once the length arrives.
    if (kind === 'stream') this.showNotificationOnce(player, kind);
    if (fellBack) this.showNotice({ kind: 'switched', to: kind }, SWITCHED_MS);
    this.armStartTimer(token, kind);
    this.listenForHeadphones();
  }

  /**
   * A source that has not made a sound in time has failed, so the ladder falls one step. The clock
   * runs only while the narration is meant to be playing: a tourist who pauses before the first
   * sound has not failed it.
   */
  private armStartTimer(token: number, kind: 'file' | 'stream'): void {
    clearTimeout(this.startTimer);
    if (this.everPlayed) return;
    this.startTimer = setTimeout(() => {
      if (token === this.sequence && !this.everPlayed) this.fallFrom(token, kind);
    }, START_TIMEOUT_MS);
  }

  private showNotificationOnce(player: AudioPlayer, kind: 'file' | 'stream'): void {
    const narration = usePlayerStore.getState().current;
    if (this.inNotification || narration === null) return;
    this.inNotification = true;
    this.showInNotification(player, narration, kind);
  }

  /** The Place in Android's media notification: always a picture, and never a failure that stops the sound. */
  private showInNotification(
    player: AudioPlayer,
    narration: Narration,
    kind: 'file' | 'stream',
  ): void {
    const options = {
      showSeekBackward: kind === 'file',
      showSeekForward: false,
      isLiveStream: kind === 'stream',
    };
    const metadata = {
      title: narration.place.name,
      artist: areaNameOf(narration.place.areaId),
    };
    const artworkUrl = narration.place.cardPhotoUrl ?? fallbackArtworkUrl();
    try {
      player.setActiveForLockScreen(
        true,
        artworkUrl === undefined ? metadata : { ...metadata, artworkUrl },
        options,
      );
    } catch {
      try {
        player.setActiveForLockScreen(true, metadata, options);
      } catch {
        // The sound plays without a notification rather than not at all.
      }
    }
  }

  private startDevice(token: number, fellBack: boolean): void {
    const narration = usePlayerStore.getState().current;
    if (narration === null) return;
    this.teardownAudio();
    this.sentences = splitSentences(narration.place.text);
    this.sentenceIndex = 0;
    this.patch({ source: 'device', positionMs: null, durationMs: null });
    if (fellBack) this.showNotice({ kind: 'switched', to: 'device' }, SWITCHED_MS);
    this.listenForHeadphones();
    this.speakFrom(token);
  }

  // ——— the device voice ———

  private speakFrom(token: number): void {
    const narration = usePlayerStore.getState().current;
    if (token !== this.sequence || narration === null) return;
    const sentence = this.sentences[this.sentenceIndex];
    if (sentence === undefined) {
      this.ended(token);
      return;
    }
    const index = this.sentenceIndex;
    Speech.speak(sentence, {
      language: engineLocale(narration.lang),
      rate: useAppStore.getState().playbackSpeed,
      onDone: () => {
        if (token !== this.sequence || index !== this.sentenceIndex) return;
        this.sentenceIndex += 1;
        this.speakFrom(token);
      },
      onError: () => {
        if (token === this.sequence) this.ended(token);
      },
    });
  }

  // ——— events ———

  private onStatus(token: number, kind: 'file' | 'stream', status: AudioStatus): void {
    if (token !== this.sequence) return;
    if (status.error !== null) {
      this.fallFrom(token, kind);
      return;
    }
    if (status.didJustFinish) {
      this.ended(token);
      return;
    }
    if (kind === 'file' && status.duration > 0 && this.audio !== null) {
      this.showNotificationOnce(this.audio, kind);
    }
    if (status.playing) {
      this.everPlayed = true;
      clearTimeout(this.startTimer);
    }
    // Before the first sound, and while buffering, "not playing" is not a pause.
    if (this.everPlayed && !status.isBuffering) {
      this.setPause({ type: 'status', playing: status.playing });
    }
    if (kind === 'file') {
      this.patch({
        positionMs: Math.round(status.currentTime * 1000),
        durationMs:
          status.duration > 0
            ? Math.round(status.duration * 1000)
            : (usePlayerStore.getState().current?.durationMs ?? null),
      });
    }
  }

  private onNoisy(): void {
    const current = usePlayerStore.getState().current;
    if (current === null || current.paused === 'headphones') return;
    this.setPause({ type: 'headphones' });
    this.halt();
  }

  /** A source failed: the next rung down, with the *switched* note. */
  private fallFrom(token: number, kind: 'file' | 'stream'): void {
    if (token !== this.sequence) return;
    this.teardownAudio();
    clearTimeout(this.startTimer);
    this.patch({ source: null });
    const rung: Rung = kind === 'file' ? 'stream' : 'device';
    this.sequence += 1;
    void this.run(
      this.sequence,
      useNetworkStore.getState().status === 'offline' ? 'device' : rung,
      true,
    );
  }

  private ended(token: number): void {
    if (token !== this.sequence) return;
    this.advance();
  }

  /** What follows a narration: *Up next* starts by itself, else the player goes quiet. */
  private advance(): void {
    const { next } = usePlayerStore.getState();
    if (next === null) this.stop();
    else this.begin(next, 'auto', null, null);
  }

  // ——— plumbing ———

  private setPause(event: Parameters<typeof nextPause>[1]): void {
    const current = usePlayerStore.getState().current;
    if (current === null) return;
    const paused: PauseReason | null = nextPause(current.paused, event);
    if (paused !== current.paused) this.patch({ paused });
  }

  /** Stops the sound without ending the narration. */
  private halt(): void {
    const source = usePlayerStore.getState().current?.source;
    if (source === 'device') void Speech.stop();
    else this.audio?.pause();
  }

  private carryOn(): void {
    const current = usePlayerStore.getState().current;
    if (current?.source === 'device') this.speakFrom(this.sequence);
    else this.audio?.play();
  }

  private patch(changes: Partial<Narration>): void {
    const current = usePlayerStore.getState().current;
    if (current !== null) usePlayerStore.setState({ current: { ...current, ...changes } });
  }

  private showNotice(notice: PlayerNotice, ms: number): void {
    clearTimeout(this.noticeTimer);
    usePlayerStore.setState({ notice });
    this.noticeTimer = setTimeout(() => usePlayerStore.setState({ notice: null }), ms);
  }

  private async prepareAudio(): Promise<void> {
    if (this.modeReady) return;
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'doNotMix',
      shouldPlayInBackground: true,
      allowsRecording: false,
      shouldRouteThroughEarpiece: false,
    });
    this.modeReady = true;
  }

  private listenForHeadphones(): void {
    this.stopListeningNoisy ??= onBecomingNoisy(() => this.onNoisy());
  }

  private teardownAudio(): void {
    for (const subscription of this.subscriptions) subscription.remove();
    this.subscriptions = [];
    const player = this.audio;
    this.audio = null;
    if (player === null) return;
    // Each step on its own: one that throws must never leave the sound playing.
    for (const step of [
      () => player.pause(),
      () => player.clearLockScreenControls(),
      () => player.remove(),
    ]) {
      try {
        step();
      } catch {
        // Already released.
      }
    }
  }

  private teardown(): void {
    this.teardownAudio();
    void Speech.stop();
    clearTimeout(this.startTimer);
  }

  private clearTimers(): void {
    clearTimeout(this.ringTimer);
    clearTimeout(this.noticeTimer);
    usePlayerStore.setState({ notice: null });
  }
}

export const narrationPlayer = new NarrationPlayer();

/** The kind of source for the screens' notes. */
export type { SourceKind };
