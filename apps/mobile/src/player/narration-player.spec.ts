import { AnalyticsTrigger, AudioTier } from '@wayfare/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerPlace } from '../data/player-place';
import type { LadderDeps, Resolution, Rung } from './ladder';

// ——— the native and network edges ———

interface Status {
  playing: boolean;
  isBuffering: boolean;
  error: string | null;
  didJustFinish: boolean;
  duration: number;
  currentTime: number;
}

/** One expo-audio player, as far as the narration player uses it. */
class FakeAudio {
  static made: FakeAudio[] = [];
  static lockScreenFailures = 0;
  playing = false;
  rate = 1;
  removed = false;
  seekedTo: number | null = null;
  lockScreen: { metadata: Record<string, string>; options: Record<string, boolean> } | null = null;
  private listener: ((status: Status) => void) | null = null;
  constructor(
    readonly source: { uri: string; headers?: Record<string, string> },
    readonly options: object,
  ) {
    FakeAudio.made.push(this);
  }
  addListener(_name: string, listener: (status: Status) => void) {
    this.listener = listener;
    return { remove: () => (this.listener = null) };
  }
  emit(status: Partial<Status>) {
    this.listener?.({
      playing: true,
      isBuffering: false,
      error: null,
      didJustFinish: false,
      duration: 0,
      currentTime: 0,
      ...status,
    });
  }
  play() {
    this.playing = true;
  }
  pause() {
    this.playing = false;
  }
  seekTo(seconds: number) {
    this.seekedTo = seconds;
    return Promise.resolve();
  }
  setPlaybackRate(rate: number) {
    this.rate = rate;
  }
  setActiveForLockScreen(
    _active: boolean,
    metadata: Record<string, string>,
    options: Record<string, boolean>,
  ) {
    if (FakeAudio.lockScreenFailures > 0) {
      FakeAudio.lockScreenFailures -= 1;
      throw new Error('no notification');
    }
    this.lockScreen = { metadata, options };
  }
  clearLockScreenControls() {
    throw new Error('already released');
  }
  remove() {
    this.removed = true;
  }
}

const audioModule = vi.hoisted(() => ({
  createAudioPlayer: vi.fn(),
  setAudioModeAsync: vi.fn(() => Promise.resolve()),
}));
vi.mock('expo-audio', () => audioModule);
const haptics = vi.hoisted(() => ({
  impactAsync: vi.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Medium: 'medium' },
}));
vi.mock('expo-haptics', () => haptics);
interface Utterance {
  text: string;
  options: {
    language: string;
    rate: number;
    onStart: () => void;
    onDone: () => void;
    onError: () => void;
  };
}
const speech = vi.hoisted(() => ({
  spoken: [] as Utterance[],
  speak: vi.fn((text: string, options: Utterance['options']) =>
    speech.spoken.push({ text, options }),
  ),
  stop: vi.fn(() => Promise.resolve()),
  getAvailableVoicesAsync: vi.fn(() => Promise.resolve([{ language: 'vi-VN' }])),
}));
vi.mock('expo-speech', () => speech);
const noisy = vi.hoisted(() => ({ listener: null as (() => void) | null }));
vi.mock('../../modules/noisy-audio/src', () => ({
  onBecomingNoisy: (listener: () => void) => {
    noisy.listener = listener;
    return () => (noisy.listener = null);
  },
}));
const tracker = vi.hoisted(() => ({
  begin: vi.fn((_placeId: string, _lang: string, _trigger: string) => undefined),
  end: vi.fn((_finished: boolean) => undefined),
  sounding: vi.fn((_tier: string) => undefined),
  silent: vi.fn(),
}));
vi.mock('../analytics/narration-tracker', () => ({ narrationTracker: tracker }));
vi.mock('../api', () => ({ APP_VERSION: '2.0.0' }));
vi.mock('../env', () => ({ API_URL: 'https://api.test/api/v1' }));
const session = vi.hoisted(() => ({
  accessToken: vi.fn(() => Promise.resolve<string | null>('tok')),
}));
vi.mock('../session', () => ({ deviceSession: session }));
vi.mock('./area-name', () => ({ areaNameOf: (areaId: string | null) => `area ${areaId}` }));
const artwork = vi.hoisted(() => ({
  fallbackArtworkUrl: vi.fn<() => string | undefined>(() => 'cache:/art.png'),
}));
vi.mock('./fallback-artwork', () => artwork);
const packs = vi.hoisted(() => ({ packAudioUri: vi.fn((_sha: string) => null as string | null) }));
vi.mock('../packs/use-pack-files', () => packs);
const audioCache = vi.hoisted(() => ({
  cachedFile: vi.fn(() => Promise.resolve<string | null>('doc:/cached.mp3')),
  downloadToCache: vi.fn(() => Promise.resolve('doc:/downloaded.mp3')),
}));
vi.mock('../data/audio-cache', () => audioCache);
const finished = vi.hoisted(() => ({ markStoryFinished: vi.fn(() => Promise.resolve()) }));
vi.mock('../tours/finished', () => finished);
const api = vi.hoisted(() => ({
  getNarrationStreamUrl: ({ placeId, lang }: { placeId: string; lang: string }) =>
    `/narration/tts/stream?placeId=${placeId}&lang=${lang}`,
  narrationOnDemand: vi.fn(),
  narrationStatus: vi.fn(),
}));
vi.mock('@wayfare/api-client', () => api);
vi.mock('expo-sqlite/kv-store', () =>
  import('../testing/player-fakes').then((m) => m.kvStoreModule),
);

/** The ladder answers what each test says; the deps it was handed are kept for their own tests. */
const ladder = vi.hoisted(() => ({
  answers: [] as (Resolution | Promise<Resolution> | Error)[],
  calls: [] as { rung: Rung; fellBack: boolean; deps: LadderDeps }[],
}));
vi.mock('./ladder', () => ({
  resolveSource: (
    _place: unknown,
    _lang: unknown,
    rung: Rung,
    deps: LadderDeps,
    fellBack: boolean,
  ) => {
    ladder.calls.push({ rung, fellBack, deps });
    const answer = ladder.answers.shift() ?? { kind: 'unavailable' };
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  },
}));

// ——— the player, fresh for each test ———

const place = (id: string, overrides: Partial<PlayerPlace> = {}): PlayerPlace => ({
  id,
  name: `Place ${id}`,
  text: 'Chợ mở cửa từ 1914. Nó bán mọi thứ!',
  textLang: 'vi',
  ownLanguage: true,
  categoryCode: 'MARKET',
  areaId: 'd1',
  audio: { url: `https://media.test/${id}.mp3`, sha256: `sha-${id}`, durationMs: 90_000 },
  cardPhotoUrl: `https://media.test/${id}.jpg`,
  ...overrides,
});
const file = (fellBack = false, tier: 'T1' | 'T1_5' = 'T1'): Resolution => ({
  kind: 'file',
  uri: 'doc:/a.mp3',
  fellBack,
  tier,
});
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

async function load() {
  vi.resetModules();
  const { narrationPlayer } = await import('./narration-player');
  const { usePlayerStore } = await import('./store');
  const { useAppStore } = await import('../state/app-store');
  const { useNetworkStore } = await import('../network/network-store');
  useAppStore.setState({ language: 'vi', playbackSpeed: 1 });
  return { narrationPlayer, player: usePlayerStore, app: useAppStore, network: useNetworkStore };
}
type Loaded = Awaited<ReturnType<typeof load>>;
const lastAudio = () => FakeAudio.made.at(-1)!;

beforeEach(() => {
  vi.clearAllMocks();
  FakeAudio.made = [];
  FakeAudio.lockScreenFailures = 0;
  speech.spoken = [];
  noisy.listener = null;
  ladder.answers = [];
  ladder.calls = [];
  audioModule.createAudioPlayer.mockImplementation(
    (source: FakeAudio['source'], options: object) => new FakeAudio(source, options),
  );
});
afterEach(() => vi.useRealTimers());

describe('playing a narration (conventions §12.3)', () => {
  it('plays the file the ladder found, at the chosen speed, setting the audio mode once', async () => {
    const { narrationPlayer, player, app } = await load();
    app.setState({ playbackSpeed: 1.25 });
    ladder.answers.push(file(), file());
    narrationPlayer.play(place('p1'));
    expect(player.getState().current).toMatchObject({
      source: null,
      started: 'manual',
      ring: false,
    });
    await flush();
    expect(lastAudio().source).toEqual({ uri: 'doc:/a.mp3' });
    expect(lastAudio()).toMatchObject({ playing: true, rate: 1.25 });
    expect(player.getState().current).toMatchObject({
      source: 'file',
      lang: 'vi',
      durationMs: 90_000,
    });
    expect(tracker.begin).toHaveBeenCalledWith('p1', 'vi', AnalyticsTrigger.TAP);
    narrationPlayer.play(place('p2'), AnalyticsTrigger.QR);
    await flush();
    expect(audioModule.setAudioModeAsync).toHaveBeenCalledTimes(1);
    expect(FakeAudio.made[0]!.removed).toBe(true);
    expect(tracker.begin).toHaveBeenLastCalledWith('p2', 'vi', AnalyticsTrigger.QR);
  });

  it('counts only the time sound plays, follows the file’s timeline, and posts its card once it knows the length', async () => {
    const { narrationPlayer, player } = await load();
    ladder.answers.push(file(false, 'T1_5'));
    narrationPlayer.play(place('p1'));
    await flush();
    const audio = lastAudio();
    audio.emit({ playing: false, isBuffering: true, duration: 0 });
    expect(tracker.silent).toHaveBeenCalled();
    expect(audio.lockScreen).toBeNull();
    expect(player.getState().current).toMatchObject({ positionMs: 0, durationMs: 90_000 });
    audio.emit({ playing: true, duration: 95.4, currentTime: 12.3 });
    expect(tracker.sounding).toHaveBeenCalledWith(AudioTier.T1_5);
    expect(player.getState().current).toMatchObject({ positionMs: 12_300, durationMs: 95_400 });
    expect(audio.lockScreen).toEqual({
      metadata: { title: 'Place p1', artist: 'area d1', artworkUrl: 'https://media.test/p1.jpg' },
      options: { showSeekBackward: true, showSeekForward: false, isLiveStream: false },
    });
    audio.lockScreen = null;
    audio.emit({ playing: true, duration: 95.4, currentTime: 13 });
    expect(audio.lockScreen).toBeNull();
  });

  it('shows the app icon for a Place with no photo, and the card without art when the art is refused', async () => {
    const { narrationPlayer } = await load();
    ladder.answers.push(file(), file(), file());
    narrationPlayer.play(place('p1', { cardPhotoUrl: null }));
    await flush();
    lastAudio().emit({ duration: 10 });
    expect(lastAudio().lockScreen?.metadata.artworkUrl).toBe('cache:/art.png');
    FakeAudio.lockScreenFailures = 1;
    narrationPlayer.play(place('p2'));
    await flush();
    lastAudio().emit({ duration: 10 });
    expect(lastAudio().lockScreen?.metadata).toEqual({ title: 'Place p2', artist: 'area d1' });
    artwork.fallbackArtworkUrl.mockReturnValueOnce(undefined);
    FakeAudio.lockScreenFailures = 2;
    narrationPlayer.play(place('p3', { cardPhotoUrl: null }));
    await flush();
    lastAudio().emit({ duration: 10 });
    expect(lastAudio()).toMatchObject({ playing: true, lockScreen: null });
  });

  it('reads it live with the device’s bearer, its card at once as a live stream (T2)', async () => {
    const { narrationPlayer, player } = await load();
    ladder.answers.push({ kind: 'stream', fellBack: false }, { kind: 'stream', fellBack: false });
    narrationPlayer.play(place('p1'));
    await flush();
    expect(lastAudio().source).toEqual({
      uri: 'https://api.test/api/v1/narration/tts/stream?placeId=p1&lang=vi',
      headers: {
        'x-wayfare-client': 'mobile',
        'x-wayfare-app-version': '2.0.0',
        authorization: 'Bearer tok',
      },
    });
    expect(lastAudio().lockScreen?.options).toMatchObject({
      isLiveStream: true,
      showSeekBackward: false,
    });
    lastAudio().emit({ playing: true, currentTime: 5 });
    expect(tracker.sounding).toHaveBeenCalledWith(AudioTier.T2);
    expect(player.getState().current).toMatchObject({ source: 'stream', positionMs: null });
    session.accessToken.mockRejectedValueOnce(new Error('offline'));
    narrationPlayer.play(place('p2'));
    await flush();
    expect(lastAudio().source.headers).not.toHaveProperty('authorization');
  });

  it('has the phone read it sentence by sentence, in its locale, then counts it finished', async () => {
    const { narrationPlayer, player, app } = await load();
    app.setState({ language: 'zh-Hans', playbackSpeed: 1.5 });
    ladder.answers.push({ kind: 'device', fellBack: false });
    narrationPlayer.play(place('p1'));
    await flush();
    expect(player.getState().current).toMatchObject({
      source: 'device',
      positionMs: null,
      durationMs: null,
    });
    expect(speech.spoken.map((u) => u.text)).toEqual(['Chợ mở cửa từ 1914.']);
    expect(speech.spoken[0]!.options).toMatchObject({ language: 'zh-CN', rate: 1.5 });
    speech.spoken[0]!.options.onStart();
    expect(tracker.sounding).toHaveBeenCalledWith(AudioTier.T3);
    speech.spoken[0]!.options.onDone();
    speech.spoken[0]!.options.onDone();
    expect(speech.spoken.map((u) => u.text)).toEqual(['Chợ mở cửa từ 1914.', 'Nó bán mọi thứ!']);
    speech.spoken[1]!.options.onDone();
    await flush();
    expect(finished.markStoryFinished).toHaveBeenCalledWith('p1');
    expect(tracker.end).toHaveBeenCalledWith(true);
    expect(player.getState().current).toBeNull();
  });

  it('ends the phone’s reading when its voice fails', async () => {
    const { narrationPlayer, player } = await load();
    ladder.answers.push({ kind: 'device', fellBack: false });
    narrationPlayer.play(place('p1'));
    await flush();
    speech.spoken[0]!.options.onError();
    expect(player.getState().current).toBeNull();
    expect(finished.markStoryFinished).toHaveBeenCalledWith('p1');
  });

  it('says a source was swapped for a few seconds', async () => {
    vi.useFakeTimers();
    const { narrationPlayer, player } = await load();
    ladder.answers.push({ kind: 'device', fellBack: true });
    narrationPlayer.play(place('p1'));
    await flush();
    expect(player.getState().notice).toEqual({ kind: 'switched', to: 'device' });
    vi.advanceTimersByTime(4_000);
    expect(player.getState().notice).toBeNull();
  });

  it('tells a tap there is nothing to play, and skips an auto start silently to what waits', async () => {
    vi.useFakeTimers();
    const { narrationPlayer, player } = await load();
    narrationPlayer.play(place('p1'));
    await flush();
    expect(player.getState()).toMatchObject({
      current: null,
      notice: { kind: 'unavailable', place: { id: 'p1' } },
    });
    narrationPlayer.closeNotice();
    expect(player.getState().notice).toBeNull();
    ladder.answers.push({ kind: 'unavailable' }, file());
    player.setState({ next: place('p2') });
    narrationPlayer.offer(place('p3'));
    await flush();
    await flush();
    expect(player.getState().notice).toBeNull();
    expect(player.getState().current).toMatchObject({ place: { id: 'p2' }, started: 'auto' });
  });

  it('closes the player when the ladder drops the answer, or fails outright', async () => {
    const { narrationPlayer, player } = await load();
    ladder.answers.push({ kind: 'discarded' }, new Error('boom'));
    narrationPlayer.play(place('p1'));
    await flush();
    expect(player.getState().current).toBeNull();
    expect(tracker.end).toHaveBeenCalledWith(false);
    narrationPlayer.play(place('p2'));
    await flush();
    expect(player.getState().notice).toMatchObject({ kind: 'unavailable' });
  });

  it('drops an answer for a narration already left', async () => {
    const { narrationPlayer, player } = await load();
    let answer: (resolution: Resolution) => void = () => undefined;
    ladder.answers.push(new Promise<Resolution>((resolve) => (answer = resolve)));
    narrationPlayer.play(place('p1'));
    narrationPlayer.stop();
    answer(file());
    await flush();
    expect(FakeAudio.made).toHaveLength(0);
    expect(player.getState().current).toBeNull();
  });
});

describe('a source that fails (product §F3)', () => {
  it('falls from the file to the stream, and from the stream to the voice, saying so', async () => {
    const { narrationPlayer } = await load();
    ladder.answers.push(
      file(),
      { kind: 'stream', fellBack: true },
      { kind: 'device', fellBack: true },
    );
    narrationPlayer.play(place('p1'));
    await flush();
    lastAudio().emit({ error: 'decoder' });
    await flush();
    lastAudio().emit({ error: 'reset' });
    await flush();
    expect(ladder.calls.map(({ rung, fellBack }) => [rung, fellBack])).toEqual([
      ['file', false],
      ['stream', true],
      ['device', true],
    ]);
  });

  it('goes straight to the phone’s voice when offline', async () => {
    const { narrationPlayer, network } = await load();
    ladder.answers.push(file());
    narrationPlayer.play(place('p1'));
    await flush();
    network.setState({ status: 'offline' });
    lastAudio().emit({ error: 'gone' });
    await flush();
    expect(ladder.calls.at(-1)).toMatchObject({ rung: 'device', fellBack: true });
  });

  it('counts a source silent for 15 s as failed, but never while the tourist paused it', async () => {
    vi.useFakeTimers();
    const { narrationPlayer } = await load();
    ladder.answers.push(file(), file());
    narrationPlayer.play(place('p1'));
    await flush();
    narrationPlayer.pause();
    vi.advanceTimersByTime(20_000);
    expect(ladder.calls).toHaveLength(1);
    narrationPlayer.resume();
    vi.advanceTimersByTime(15_000);
    await flush();
    expect(ladder.calls.at(-1)).toMatchObject({ rung: 'stream', fellBack: true });
  });

  it('never counts a source that played as failed', async () => {
    vi.useFakeTimers();
    const { narrationPlayer } = await load();
    ladder.answers.push(file());
    narrationPlayer.play(place('p1'));
    await flush();
    lastAudio().emit({ playing: true });
    narrationPlayer.pause();
    narrationPlayer.resume();
    vi.advanceTimersByTime(30_000);
    expect(ladder.calls).toHaveLength(1);
  });
});

describe('the queue and the walk (round 26)', () => {
  it('starts an offer when nothing plays, with the lantern ring and a tap for two seconds', async () => {
    vi.useFakeTimers();
    const { narrationPlayer, player } = await load();
    ladder.answers.push(file());
    expect(narrationPlayer.offer(place('p1'), { distanceM: 12 })).toBe('start');
    expect(player.getState().current).toMatchObject({ started: 'auto', ring: true, distanceM: 12 });
    expect(haptics.impactAsync).toHaveBeenCalledWith('medium');
    expect(tracker.begin).toHaveBeenCalledWith('p1', 'vi', AnalyticsTrigger.GEOFENCE);
    vi.advanceTimersByTime(2_000);
    expect(player.getState().current?.ring).toBe(false);
  });

  it('keeps an offer waiting when one plays, and refuses a third', async () => {
    const { narrationPlayer, player } = await load();
    ladder.answers.push(file());
    narrationPlayer.offer(place('p1'));
    expect(narrationPlayer.offer(place('p2'))).toBe('queued');
    expect(narrationPlayer.offer(place('p3'))).toBe('refused');
    expect(narrationPlayer.offer(place('p2'))).toBe('duplicate');
    expect(player.getState().next?.id).toBe('p2');
  });

  it('starts what waits by itself when a story ends, and goes quiet with nothing waiting', async () => {
    const { narrationPlayer, player } = await load();
    ladder.answers.push(file(), file());
    narrationPlayer.play(place('p1'));
    narrationPlayer.offer(place('p2'));
    await flush();
    lastAudio().emit({ didJustFinish: true });
    await flush();
    expect(finished.markStoryFinished).toHaveBeenCalledWith('p1');
    expect(player.getState()).toMatchObject({
      current: { place: { id: 'p2' }, started: 'auto' },
      next: null,
    });
    expect(tracker.begin).toHaveBeenLastCalledWith('p2', 'vi', AnalyticsTrigger.GEOFENCE);
    lastAudio().emit({ didJustFinish: true });
    expect(player.getState().current).toBeNull();
  });

  it('a manual play takes the asked Place out of Up next, and skip plays what waits or stops', async () => {
    const { narrationPlayer, player } = await load();
    ladder.answers.push(file(), file(), file());
    narrationPlayer.play(place('p1'));
    narrationPlayer.offer(place('p2'));
    narrationPlayer.play(place('p2'));
    expect(player.getState().next).toBeNull();
    narrationPlayer.offer(place('p3'));
    narrationPlayer.skip();
    expect(player.getState().current?.place.id).toBe('p3');
    narrationPlayer.skip();
    expect(player.getState().current).toBeNull();
  });
});

describe('the controls', () => {
  it('pauses and resumes the file; the toggle does nothing before a source plays', async () => {
    const { narrationPlayer, player } = await load();
    narrationPlayer.togglePause();
    ladder.answers.push(file());
    narrationPlayer.play(place('p1'));
    narrationPlayer.togglePause();
    await flush();
    narrationPlayer.togglePause();
    expect(player.getState().current?.paused).toBe('user');
    expect(lastAudio().playing).toBe(false);
    expect(tracker.silent).toHaveBeenCalled();
    narrationPlayer.togglePause();
    expect(player.getState().current?.paused).toBeNull();
    expect(lastAudio().playing).toBe(true);
  });

  it('keeps a pause the tourist asked for when a source is swapped in', async () => {
    const { narrationPlayer } = await load();
    ladder.answers.push(file(), { kind: 'stream', fellBack: true });
    narrationPlayer.play(place('p1'));
    await flush();
    narrationPlayer.pause();
    lastAudio().emit({ error: 'decoder' });
    await flush();
    expect(lastAudio().playing).toBe(false);
  });

  it('stops and restarts the phone’s voice on pause and resume', async () => {
    const { narrationPlayer } = await load();
    ladder.answers.push({ kind: 'device', fellBack: false });
    narrationPlayer.play(place('p1'));
    await flush();
    speech.stop.mockClear();
    narrationPlayer.pause();
    expect(speech.stop).toHaveBeenCalled();
    narrationPlayer.resume();
    expect(speech.spoken).toHaveLength(2);
    expect(speech.spoken[1]!.text).toBe('Chợ mở cửa từ 1914.');
  });

  it('marks a pause the system made, and clears it when the system resumes', async () => {
    const { narrationPlayer, player } = await load();
    ladder.answers.push(file());
    narrationPlayer.play(place('p1'));
    await flush();
    lastAudio().emit({ playing: true });
    lastAudio().emit({ playing: false });
    expect(player.getState().current?.paused).toBe('system');
    lastAudio().emit({ playing: true });
    expect(player.getState().current?.paused).toBeNull();
  });

  it('pauses when the headphones come out, once', async () => {
    const { narrationPlayer, player } = await load();
    ladder.answers.push(file());
    narrationPlayer.play(place('p1'));
    await flush();
    noisy.listener?.();
    expect(player.getState().current?.paused).toBe('headphones');
    expect(lastAudio().playing).toBe(false);
    tracker.silent.mockClear();
    noisy.listener?.();
    expect(tracker.silent).not.toHaveBeenCalled();
    narrationPlayer.stop();
    noisy.listener?.();
    expect(player.getState().current).toBeNull();
  });

  it('replays the file from the start, and the voice from its first sentence', async () => {
    const { narrationPlayer } = await load();
    narrationPlayer.replay();
    ladder.answers.push(file(), { kind: 'device', fellBack: false });
    narrationPlayer.play(place('p1'));
    await flush();
    narrationPlayer.pause();
    narrationPlayer.replay();
    expect(lastAudio()).toMatchObject({ seekedTo: 0, playing: true });
    narrationPlayer.play(place('p2'));
    await flush();
    speech.spoken[0]!.options.onDone();
    narrationPlayer.replay();
    expect(speech.spoken.at(-1)!.text).toBe('Chợ mở cửa từ 1914.');
  });

  it('seeks within a file only', async () => {
    const { narrationPlayer } = await load();
    narrationPlayer.seek(1_000);
    ladder.answers.push(file(), { kind: 'stream', fellBack: false });
    narrationPlayer.play(place('p1'));
    await flush();
    narrationPlayer.seek(42_000);
    expect(lastAudio().seekedTo).toBe(42);
    narrationPlayer.play(place('p2'));
    await flush();
    narrationPlayer.seek(5_000);
    expect(lastAudio().seekedTo).toBeNull();
  });

  it('moves through the speeds, the playing file following', async () => {
    const { narrationPlayer, app } = await load();
    narrationPlayer.cycleSpeed();
    expect(app.getState().playbackSpeed).toBe(1.25);
    ladder.answers.push(file());
    narrationPlayer.play(place('p1'));
    await flush();
    narrationPlayer.cycleSpeed();
    narrationPlayer.cycleSpeed();
    expect(app.getState().playbackSpeed).toBe(0.75);
    expect(lastAudio().rate).toBe(0.75);
  });

  it('tells the mini player what the Place sheet shows', async () => {
    const { narrationPlayer, player } = await load();
    narrationPlayer.setSheet('p1', false, 320);
    expect(player.getState().sheet).toEqual({ placeId: 'p1', peek: false, height: 320 });
    narrationPlayer.setSheet(null, true);
    expect(player.getState().sheet).toEqual({ placeId: null, peek: true, height: 0 });
  });
});

describe('a language switch', () => {
  const rebuild = (lang: string) => (placeId: string) =>
    Promise.resolve(place(placeId, { name: `${placeId} in ${lang}` }));

  it('restarts a story still being prepared in the new language, and rebuilds Up next', async () => {
    const { narrationPlayer, player, app } = await load();
    ladder.answers.push(new Promise<Resolution>(() => undefined), file());
    narrationPlayer.play(place('p1'));
    narrationPlayer.offer(place('p2'));
    app.setState({ language: 'en' });
    await narrationPlayer.relanguage(rebuild('en'));
    expect(player.getState().current).toMatchObject({ lang: 'en', place: { name: 'p1 in en' } });
    expect(player.getState().next?.name).toBe('p2 in en');
  });

  it('lets a story already playing finish in its language', async () => {
    const { narrationPlayer, player, app } = await load();
    ladder.answers.push(file());
    narrationPlayer.play(place('p1'));
    await flush();
    app.setState({ language: 'en' });
    await narrationPlayer.relanguage(rebuild('en'));
    expect(player.getState().current).toMatchObject({ lang: 'vi', source: 'file' });
  });

  it('keeps a record it can’t rebuild, and what the tourist started meanwhile wins', async () => {
    const { narrationPlayer, player, app } = await load();
    ladder.answers.push(
      new Promise<Resolution>(() => undefined),
      new Promise<Resolution>(() => undefined),
    );
    narrationPlayer.play(place('p1'));
    app.setState({ language: 'en' });
    let release: () => void = () => undefined;
    const slow = (placeId: string) =>
      new Promise<PlayerPlace>((resolve) => (release = () => resolve(place(placeId))));
    const switching = narrationPlayer.relanguage((placeId) =>
      placeId === 'p1' ? slow(placeId) : Promise.reject(new Error('gone')),
    );
    narrationPlayer.play(place('p9'));
    release();
    await switching;
    expect(player.getState().current?.place.id).toBe('p9');
    narrationPlayer.stop();
    await narrationPlayer.relanguage(() => Promise.reject(new Error('gone')));
    expect(player.getState().current).toBeNull();
  });

  it('restarts with the old record when the new one can’t be read', async () => {
    const { narrationPlayer, player, app } = await load();
    ladder.answers.push(new Promise<Resolution>(() => undefined), file());
    narrationPlayer.play(place('p1'));
    app.setState({ language: 'en' });
    await narrationPlayer.relanguage(() => Promise.reject(new Error('gone')));
    expect(player.getState().current).toMatchObject({ lang: 'en', place: { name: 'Place p1' } });
  });
});

describe('what the ladder is handed', () => {
  async function deps(state?: (loaded: Loaded) => void) {
    const loaded = await load();
    state?.(loaded);
    loaded.narrationPlayer.play(place('p1'));
    await flush();
    return ladder.calls[0]!.deps;
  }

  it('the language heard now, and offline from the network probe', async () => {
    const handed = await deps(({ network }) => network.setState({ status: 'offline' }));
    expect(handed.currentLang()).toBe('vi');
    expect(handed.isOffline()).toBe(true);
  });

  it('reads the server’s on-demand answer as the ladder’s', async () => {
    const handed = await deps();
    const audio = { url: 'u', sha256: 's', durationMs: 1 };
    api.narrationOnDemand.mockResolvedValueOnce({ data: { status: 'READY', audio } });
    expect(await handed.onDemand('p1', 'vi')).toEqual({ status: 'READY', audio });
    api.narrationOnDemand.mockResolvedValueOnce({ data: { status: 'PENDING', retryAfterMs: 900 } });
    expect(await handed.onDemand('p1', 'vi')).toEqual({ status: 'PENDING', retryAfterMs: 900 });
    api.narrationOnDemand.mockResolvedValueOnce({ data: { status: 'NOT_AVAILABLE' } });
    expect(await handed.onDemand('p1', 'vi')).toEqual({ status: 'UNAVAILABLE' });
    api.narrationStatus.mockResolvedValueOnce({ data: { audio } });
    expect(await handed.status('p1', 'vi')).toEqual(audio);
    api.narrationStatus.mockResolvedValueOnce({ data: {} });
    expect(await handed.status('p1', 'vi')).toBeNull();
  });

  it('a downloaded pack’s story before the audio cache, and the cache’s download', async () => {
    const handed = await deps();
    const audio = { url: 'u', sha256: 's', durationMs: 1 };
    packs.packAudioUri.mockReturnValueOnce('pack:/s.mp3');
    expect(await handed.cachedFile(place('p1'), audio, 'vi')).toBe('pack:/s.mp3');
    expect(await handed.cachedFile(place('p1'), audio, 'vi')).toBe('doc:/cached.mp3');
    expect(handed.download).toBe(audioCache.downloadToCache);
  });

  it('whether the phone has a voice for the language, and a real clock', async () => {
    const handed = await deps();
    expect(await handed.hasDeviceVoice('vi')).toBe(true);
    expect(await handed.hasDeviceVoice('ja')).toBe(false);
    await expect(handed.sleep(1)).resolves.toBeUndefined();
    expect(handed.now()).toBeGreaterThan(0);
  });
});

describe('answers that arrive late', () => {
  it('drops a file or a stream whose narration ended while the audio mode was being set', async () => {
    let ready: () => void = () => undefined;
    audioModule.setAudioModeAsync.mockReturnValueOnce(
      new Promise<void>((resolve) => (ready = resolve)),
    );
    const { narrationPlayer } = await load();
    ladder.answers.push(file());
    narrationPlayer.play(place('p1'));
    await flush();
    narrationPlayer.stop();
    ready();
    await flush();
    expect(FakeAudio.made).toHaveLength(0);
  });

  it('drops a stream whose narration ended while the bearer was being read', async () => {
    let bearer: (token: string) => void = () => undefined;
    session.accessToken.mockReturnValueOnce(new Promise<string>((resolve) => (bearer = resolve)));
    const { narrationPlayer } = await load();
    ladder.answers.push({ kind: 'stream', fellBack: false });
    narrationPlayer.play(place('p1'));
    await flush();
    narrationPlayer.stop();
    bearer('tok');
    await flush();
    expect(FakeAudio.made).toHaveLength(0);
  });

  it('ignores the phone’s voice reporting on a reading already stopped', async () => {
    const { narrationPlayer } = await load();
    ladder.answers.push({ kind: 'device', fellBack: false });
    narrationPlayer.play(place('p1'));
    await flush();
    const [first] = speech.spoken;
    narrationPlayer.stop();
    first!.options.onStart();
    first!.options.onError();
    first!.options.onDone();
    expect(tracker.sounding).not.toHaveBeenCalled();
    expect(finished.markStoryFinished).not.toHaveBeenCalled();
  });

  it('keeps an Up next the tourist changed during a language switch', async () => {
    const { narrationPlayer, player, app } = await load();
    ladder.answers.push(file());
    narrationPlayer.play(place('p1'));
    narrationPlayer.offer(place('p2'));
    app.setState({ language: 'en' });
    const switching = narrationPlayer.relanguage((placeId) => {
      player.setState({ next: place('p7') });
      return Promise.resolve(place(placeId));
    });
    await switching;
    expect(player.getState().next?.id).toBe('p7');
  });
});

describe('a Place with no stored audio', () => {
  it('has no length until the made file tells it, in English before a language is chosen', async () => {
    const { narrationPlayer, player, app } = await load();
    app.setState({ language: null });
    ladder.answers.push(file(false, 'T1_5'));
    narrationPlayer.play(place('p1', { audio: null }));
    expect(player.getState().current).toMatchObject({ lang: 'en', durationMs: null });
    await flush();
    lastAudio().emit({ playing: true, duration: 0, currentTime: 1 });
    expect(player.getState().current).toMatchObject({ positionMs: 1_000, durationMs: null });
  });
});
