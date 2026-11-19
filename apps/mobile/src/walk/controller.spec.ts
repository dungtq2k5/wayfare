import { NARRATION_CONFIG } from '@wayfare/contracts';
import { initialGeofenceState } from '@wayfare/core';
import type { LocationFix } from '@wayfare/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HandlerDeps, HandlerState } from './handler';
import type { WalkRecord } from './machine';

vi.mock('expo-location', async () => (await import('../testing/walk-fakes')).expoLocation);
vi.mock('../data/boot', () => ({ databaseReady: Promise.resolve({ db: true }) }));
vi.mock('../i18n', () => ({ tourist: () => ({ t: (key: string) => key }) }));
const env = vi.hoisted((): { undoMs: number | undefined } => ({ undoMs: 1_000 }));
vi.mock('../env', () => ({
  WALK_IDLE_MS: undefined,
  get WALK_UNDO_MS() {
    return env.undoMs;
  },
}));
const player = vi.hoisted(() => ({
  offer: vi.fn((_place: unknown, _options: { distanceM: number }): string => 'accepted'),
}));
vi.mock('../player/narration-player', () => ({ narrationPlayer: player }));
vi.mock('../places/place-view', () => ({
  viewFromRecord: (record: unknown) => ({ view: record }),
  playerPlaceOf: (view: unknown) => ({ place: view }),
}));
/** The fix handler, as the test makes it answer; its own rules are handler.spec's. */
const handler = vi.hoisted(() => ({
  weak: false,
  retry: [] as string[],
  offerTo: null as null | string,
  decision: null as null | string,
  inputs: [] as { state: HandlerState; intervalMs: number; deps: HandlerDeps }[],
  outcomes: [] as string[],
}));
vi.mock('./handler', () => ({
  handleFix: (input: {
    fix: LocationFix;
    state: HandlerState;
    intervalMs: number;
    deps: HandlerDeps;
  }) => {
    handler.inputs.push(input);
    if (handler.offerTo !== null) handler.outcomes.push(input.deps.offer(handler.offerTo, 20));
    input.deps.log({
      type: 'engineCall',
      kind: 'evaluate',
      now: input.fix.t,
      gpsGapMs: 15_000,
      fix: null,
      decision: handler.decision,
      accepted: null,
    });
    return {
      state: { engine: input.state.engine, retry: handler.retry, reconciledAt: input.fix.t },
      weak: handler.weak,
    };
  },
}));
const places = vi.hoisted(() => ({ records: new Map<string, unknown>() }));
vi.mock('./geofence-places', () => ({
  loadWalkPlaces: vi.fn(() => Promise.resolve()),
  walkPlaces: () => ({ records: places.records, geofence: [] }),
}));
const heard = vi.hoisted(() => ({
  markHeard: vi.fn((_placeId: string, _now: number) => Promise.resolve()),
}));
vi.mock('../data/heard', () => heard);
const log = vi.hoisted(() => ({ lines: [] as Record<string, unknown>[] }));
vi.mock('./log', () => ({
  walkLog: {
    append: (line: Record<string, unknown>) => {
      log.lines.push(line);
      return Promise.resolve();
    },
  },
}));
const notify = vi.hoisted(() => ({ notifyWalkEnded: vi.fn(() => Promise.resolve()) }));
vi.mock('./notifications', () => notify);
const prefetch = vi.hoisted(() => ({
  runPrefetch: vi.fn((_fix: LocationFix, _now: number) => Promise.resolve()),
}));
vi.mock('./prefetch-run', () => prefetch);
const records = vi.hoisted(() => ({
  kept: null as WalkRecord | null,
  saved: [] as WalkRecord[],
}));
vi.mock('./records', async () => {
  const { initialWalk } = await import('./machine');
  return {
    loadWalk: () => Promise.resolve(records.kept ?? initialWalk()),
    saveWalk: (_db: unknown, walk: WalkRecord) => {
      records.saved.push(walk);
      return Promise.resolve();
    },
  };
});

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** A fresh controller: its subscriptions, queues and timers live as long as the module. */
async function load() {
  vi.resetModules();
  const controller = await import('./controller');
  const { useWalkStore, pushFix } = await import('./store');
  const { usePlayerStore } = await import('../player/store');
  const { phone, expoLocation, resetPhone } = await import('../testing/walk-fakes');
  const { nativeFake, AppState } = await import('../testing/react-native');
  resetPhone();
  return {
    ...controller,
    useWalkStore,
    pushFix,
    usePlayerStore,
    phone,
    expoLocation,
    nativeFake,
    AppState,
  };
}

type Loaded = Awaited<ReturnType<typeof load>>;

/** A walk on, as the start flow leaves it. */
async function walking(walk: Loaded, background = true) {
  walk.dispatch({ type: 'begin', areaId: 'd1' });
  walk.dispatch({ type: 'ready', background });
  await flush();
}

const fix = (t: number, lat = 10.77, accuracyM = 10): LocationFix => ({
  t,
  lat,
  lng: 106.7,
  accuracyM,
});

beforeEach(() => {
  env.undoMs = 1_000;
  handler.weak = false;
  handler.retry = [];
  handler.offerTo = null;
  handler.decision = null;
  handler.inputs = [];
  handler.outcomes = [];
  places.records = new Map();
  log.lines = [];
  records.kept = null;
  records.saved = [];
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe('starting and stopping the walk', () => {
  it('starts the updates with the foreground service when the background is granted', async () => {
    const walk = await load();
    await walking(walk);
    expect(walk.useWalkStore.getState().walk.phase).toBe('on');
    const [task, options] = walk.expoLocation.startLocationUpdatesAsync.mock.calls[0]!;
    expect(task).toBe(walk.WALK_TASK);
    expect(options).toMatchObject({
      accuracy: walk.expoLocation.Accuracy.High,
      timeInterval: NARRATION_CONFIG.gpsThrottleMs,
      foregroundService: {
        notificationTitle: 'walk.notification.title',
        killServiceOnDestroy: false,
      },
    });
    expect(walk.useWalkStore.getState().intervalMs).toBe(NARRATION_CONFIG.gpsThrottleMs);
  });

  it('runs while open only, with no service, when the background is not granted', async () => {
    const walk = await load();
    await walking(walk, false);
    expect(walk.useWalkStore.getState().walk.phase).toBe('foreground-only');
    expect(walk.expoLocation.startLocationUpdatesAsync.mock.calls[0]![1]).not.toHaveProperty(
      'foregroundService',
    );
  });

  it('keeps every change on the phone and logs the walk’s own events', async () => {
    const walk = await load();
    await walking(walk);
    expect(records.saved.map((saved) => saved.phase)).toEqual(['starting', 'on']);
    expect(log.lines.map((line) => line.event)).toEqual(['begin', 'ready']);
  });

  it('starts nothing for a simulated walk, and logs a start the phone refuses', async () => {
    const simulated = await load();
    simulated.useWalkStore.setState({ simulated: true });
    await walking(simulated);
    expect(simulated.expoLocation.startLocationUpdatesAsync).not.toHaveBeenCalled();

    const refused = await load();
    refused.expoLocation.startLocationUpdatesAsync.mockRejectedValueOnce(new Error('denied'));
    await walking(refused);
    expect(log.lines.at(-1)).toMatchObject({ type: 'error', where: 'startUpdates' });
    expect(refused.useWalkStore.getState().walk.phase).toBe('on');
  });

  it('stops at once, clears Up next, and Undo brings the walk back within its window', async () => {
    const walk = await load();
    await walking(walk);
    walk.usePlayerStore.setState({ next: { id: 'p9' } as never });
    walk.stopWalk();
    await flush();
    expect(walk.useWalkStore.getState().walk.phase).toBe('ended');
    expect(walk.expoLocation.stopLocationUpdatesAsync).toHaveBeenCalledWith(walk.WALK_TASK);
    expect(walk.usePlayerStore.getState().next).toBeNull();
    walk.undoStop();
    await flush();
    expect(walk.useWalkStore.getState().walk.phase).toBe('on');
    expect(walk.expoLocation.startLocationUpdatesAsync).toHaveBeenCalledTimes(2);
  });

  it('ends the walk for good when the Undo window runs out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'Date'] });
    env.undoMs = undefined;
    const walk = await load();
    walk.dispatch({ type: 'begin', areaId: null });
    walk.dispatch({ type: 'ready', background: true });
    walk.stopWalk();
    vi.advanceTimersByTime(NARRATION_CONFIG.walkUndoMs);
    expect(walk.useWalkStore.getState().walk.phase).toBe('off');
    walk.disposeWalk();
  });

  it('does nothing on Stop when no walk runs, and a stop the phone already made is fine', async () => {
    const walk = await load();
    walk.stopWalk();
    expect(walk.useWalkStore.getState().walk.phase).toBe('off');
    await walking(walk);
    walk.expoLocation.hasStartedLocationUpdatesAsync.mockRejectedValueOnce(new Error('gone'));
    walk.stopWalk();
    await flush();
    expect(walk.useWalkStore.getState().walk.phase).toBe('ended');
    walk.phone.updatesRunning = false;
    walk.undoStop();
    walk.stopWalk();
    await flush();
    expect(walk.expoLocation.stopLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it('re-registers from the background without asking for the service again', async () => {
    const walk = await load();
    await walking(walk);
    walk.AppState.currentState = 'background';
    try {
      walk.applyBackgroundPermission(false);
      walk.applyBackgroundPermission(true);
      await flush();
      const calls = walk.expoLocation.startLocationUpdatesAsync.mock.calls;
      expect(calls.at(-1)![1]).not.toHaveProperty('foregroundService');
    } finally {
      walk.AppState.currentState = 'active';
    }
  });
});

describe('the background permission during a walk (E3)', () => {
  it('drops to while-open when taken back, with the notice, and returns when granted', async () => {
    const walk = await load();
    await walking(walk);
    walk.applyBackgroundPermission(false);
    expect(walk.useWalkStore.getState()).toMatchObject({
      revokedNotice: true,
      walk: { phase: 'foreground-only' },
    });
    walk.applyBackgroundPermission(false);
    walk.applyBackgroundPermission(true);
    expect(walk.useWalkStore.getState()).toMatchObject({
      revokedNotice: false,
      walk: { phase: 'on' },
    });
    walk.applyBackgroundPermission(true);
    await flush();
    expect(walk.expoLocation.startLocationUpdatesAsync).toHaveBeenCalledTimes(3);
  });

  it('reads the permission again when the app comes back from the phone’s settings', async () => {
    const walk = await load();
    walk.installWalk();
    walk.installWalk();
    walk.nativeFake.appState.emit('active');
    await walking(walk);
    walk.phone.backgroundGranted = false;
    walk.nativeFake.appState.emit('background');
    await flush();
    expect(walk.useWalkStore.getState().walk.phase).toBe('on');
    walk.nativeFake.appState.emit('active');
    await flush();
    expect(walk.useWalkStore.getState().walk.phase).toBe('foreground-only');
    walk.disposeWalk();
  });
});

describe('a fix during the walk', () => {
  it('runs the engine with the walk’s memory, keeps what it answers, and warms the Places ahead', async () => {
    const walk = await load();
    walk.installWalk();
    await walking(walk);
    handler.weak = true;
    handler.retry = ['p2'];
    walk.pushFix(fix(1_000));
    await walk.settled();
    expect(handler.inputs[0]!.state).toMatchObject({ retry: [], reconciledAt: undefined });
    expect(handler.inputs[0]!.intervalMs).toBe(NARRATION_CONFIG.gpsThrottleMs);
    expect(walk.useWalkStore.getState()).toMatchObject({
      weak: true,
      retry: ['p2'],
      reconciledAt: 1_000,
    });
    expect(prefetch.runPrefetch).toHaveBeenCalledTimes(1);
    walk.disposeWalk();
  });

  it('warms the Places one run at a time', async () => {
    let finish: () => void = () => undefined;
    prefetch.runPrefetch.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)));
    const walk = await load();
    walk.installWalk();
    await walking(walk);
    walk.pushFix(fix(1_000));
    await walk.settled();
    walk.pushFix(fix(2_000));
    await walk.settled();
    expect(prefetch.runPrefetch).toHaveBeenCalledTimes(1);
    finish();
    await flush();
    walk.pushFix(fix(3_000));
    await walk.settled();
    expect(prefetch.runPrefetch).toHaveBeenCalledTimes(2);
    walk.disposeWalk();
  });

  it('hands a decided Place to the player, and counts the engine’s decisions', async () => {
    const walk = await load();
    walk.installWalk();
    await walking(walk);
    places.records = new Map([['p1', { id: 'p1' }]]);
    handler.offerTo = 'p1';
    handler.decision = 'p1';
    walk.pushFix(fix(1_000));
    await walk.settled();
    player.offer.mockReturnValueOnce('refused');
    walk.pushFix(fix(2_000));
    await walk.settled();
    handler.offerTo = 'gone';
    walk.pushFix(fix(3_000));
    await walk.settled();
    expect(handler.outcomes).toEqual(['accepted', 'refused', 'skipped']);
    expect(player.offer.mock.calls[0]![1]).toEqual({ distanceM: 20 });
    expect(walk.useWalkStore.getState().decisions).toBe(3);
    expect(log.lines.filter((line) => line.type === 'engineCall')).toHaveLength(3);
    walk.disposeWalk();
  });

  it('ignores a fix when no walk runs, the same fix twice, and the other source’s fixes', async () => {
    const walk = await load();
    walk.installWalk();
    walk.pushFix(fix(1_000));
    await walk.settled();
    expect(handler.inputs).toHaveLength(0);
    await walking(walk);
    walk.pushFix(fix(2_000), true);
    await walk.settled();
    expect(handler.inputs).toHaveLength(0);
    walk.useWalkStore.setState({ decisions: 1 });
    await walk.settled();
    expect(handler.inputs).toHaveLength(0);
    walk.disposeWalk();
  });

  it('slows the updates once the tourist has settled', async () => {
    const walk = await load();
    walk.installWalk();
    await walking(walk);
    walk.pushFix(fix(0));
    await walk.settled();
    walk.pushFix(fix(NARRATION_CONFIG.stationaryAfterMs + 1));
    await walk.settled();
    await flush();
    const options = walk.expoLocation.startLocationUpdatesAsync.mock.calls.at(-1)![1];
    expect(options).toMatchObject({
      accuracy: walk.expoLocation.Accuracy.Balanced,
      timeInterval: NARRATION_CONFIG.stationaryIntervalMs,
    });
    walk.disposeWalk();
  });

  it('never slows down while Diagnostics measures the drain', async () => {
    const walk = await load();
    walk.installWalk();
    walk.useWalkStore.setState({ stationaryMode: false });
    await walking(walk);
    walk.pushFix(fix(0));
    walk.pushFix(fix(NARRATION_CONFIG.stationaryAfterMs + 1));
    await walk.settled();
    await flush();
    expect(walk.expoLocation.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    walk.disposeWalk();
  });

  it('ends an idle walk, with its notification naming how many Places were heard', async () => {
    const walk = await load();
    walk.installWalk();
    await walking(walk);
    walk.dispatch({ type: 'heard', placeId: 'p1' });
    walk.pushFix(fix(0));
    await walk.settled();
    walk.pushFix(fix(NARRATION_CONFIG.walkIdleStopMs));
    await walk.settled();
    await flush();
    expect(walk.useWalkStore.getState().walk).toMatchObject({ phase: 'ended', endReason: 'idle' });
    expect(notify.notifyWalkEnded).toHaveBeenCalledWith(1);
    expect(walk.expoLocation.stopLocationUpdatesAsync).toHaveBeenCalled();
    walk.disposeWalk();
  });
});

describe('a narration heard during the walk', () => {
  it('marks the Place heard, adds it to the walk and logs it, once per new narration', async () => {
    const walk = await load();
    walk.installWalk();
    await walking(walk);
    const narration = { place: { id: 'p1' } } as never;
    walk.usePlayerStore.setState({ current: narration });
    walk.usePlayerStore.setState({ current: { ...(narration as object) } as never });
    walk.usePlayerStore.setState({ current: null });
    expect(heard.markHeard).toHaveBeenCalledTimes(1);
    expect(heard.markHeard.mock.calls[0]![0]).toBe('p1');
    expect(walk.useWalkStore.getState().walk.heard).toEqual(['p1']);
    expect(log.lines.filter((line) => line.type === 'narration')).toHaveLength(1);
    expect(log.lines.some((line) => line.event === 'heard')).toBe(false);
    walk.disposeWalk();
  });
});

describe('the walk’s problems while the app is in front', () => {
  async function polled(setup: (walk: Loaded) => void) {
    vi.useFakeTimers({ toFake: ['setInterval', 'Date'] });
    vi.setSystemTime(100_000);
    const walk = await load();
    walk.installWalk();
    await walking(walk);
    setup(walk);
    await vi.advanceTimersByTimeAsync(5_000);
    walk.disposeWalk();
    return walk.useWalkStore.getState();
  }

  it('says there is no position when the fixes stop', async () => {
    const state = await polled((walk) => walk.useWalkStore.setState({ fix: fix(0) }));
    expect(state).toMatchObject({ noPosition: true, locationOff: false });
  });

  it('says location is off when the phone’s switch is off', async () => {
    const state = await polled((walk) => (walk.phone.servicesEnabled = false));
    expect(state).toMatchObject({ noPosition: false, locationOff: true });
  });

  it('keeps the last answer when the phone can’t be asked', async () => {
    const state = await polled((walk) => {
      walk.useWalkStore.setState({ locationOff: true });
      walk.expoLocation.hasServicesEnabledAsync.mockRejectedValueOnce(new Error('busy'));
    });
    expect(state.locationOff).toBe(true);
  });

  it('checks nothing for a simulated walk, or with the app in the background', async () => {
    const simulated = await polled((walk) =>
      walk.useWalkStore.setState({ simulated: true, fix: fix(0) }),
    );
    expect(simulated.noPosition).toBe(false);
    const behind = await polled((walk) => {
      walk.AppState.currentState = 'background';
      walk.useWalkStore.setState({ fix: fix(0) });
    });
    const { AppState } = await import('../testing/react-native');
    AppState.currentState = 'active';
    expect(behind.noPosition).toBe(false);
  });
});

describe('the walk at launch', () => {
  const kept = (overrides: Partial<WalkRecord>): WalkRecord => ({
    phase: 'on',
    startedAt: 1,
    areaId: null,
    heard: [],
    endedAt: null,
    endReason: null,
    resumePhase: null,
    noticeDismissed: true,
    engine: initialGeofenceState(),
    lastFixAt: Date.now(),
    ...overrides,
  });

  it('carries on a walk whose task still runs, reading it once', async () => {
    const walk = await load();
    walk.phone.updatesRunning = true;
    records.kept = kept({});
    const first = walk.hydrateWalk();
    expect(walk.hydrateWalk()).toBe(first);
    await first;
    expect(walk.useWalkStore.getState()).toMatchObject({
      hydrated: true,
      walk: { phase: 'on' },
      intervalMs: NARRATION_CONFIG.gpsThrottleMs,
    });
  });

  it('says the phone stopped a walk whose task is gone or long silent', async () => {
    const gone = await load();
    records.kept = kept({ phase: 'foreground-only' });
    await gone.hydrateWalk();
    expect(gone.useWalkStore.getState().walk).toMatchObject({
      phase: 'ended',
      endReason: 'system',
    });

    const silent = await load();
    silent.phone.updatesRunning = true;
    records.kept = kept({ lastFixAt: Date.now() - 10 * NARRATION_CONFIG.stationaryIntervalMs });
    await silent.hydrateWalk();
    expect(silent.useWalkStore.getState().walk.endReason).toBe('system');
    expect(silent.expoLocation.stopLocationUpdatesAsync).toHaveBeenCalled();

    const unknown = await load();
    unknown.expoLocation.hasStartedLocationUpdatesAsync.mockRejectedValueOnce(new Error('x'));
    records.kept = kept({});
    await unknown.hydrateWalk();
    expect(unknown.useWalkStore.getState().walk.endReason).toBe('system');
  });

  it('ends a stopped walk whose Undo window did not survive, and a start left half-way', async () => {
    const stopped = await load();
    records.kept = kept({ phase: 'ended', endReason: 'stopped', resumePhase: 'on' });
    await stopped.hydrateWalk();
    await flush();
    expect(stopped.useWalkStore.getState().walk.phase).toBe('off');
    expect(records.saved.at(-1)!.phase).toBe('off');

    const starting = await load();
    records.kept = kept({ phase: 'starting' });
    await starting.hydrateWalk();
    expect(starting.useWalkStore.getState().walk.phase).toBe('off');
  });

  it('keeps an idle-ended walk for its notice, and an off one as it is', async () => {
    const idle = await load();
    records.kept = kept({ phase: 'ended', endReason: 'idle', noticeDismissed: false });
    await idle.hydrateWalk();
    expect(idle.useWalkStore.getState().walk).toMatchObject({ phase: 'ended', endReason: 'idle' });
    records.kept = null;
    const off = await load();
    await off.hydrateWalk();
    expect(off.useWalkStore.getState().walk.phase).toBe('off');
    expect(records.saved).toHaveLength(0);
  });
});

describe('Forget this install', () => {
  it('stops the updates and clears the walk', async () => {
    const walk = await load();
    await walking(walk);
    walk.useWalkStore.setState({ weak: true, simulated: true, fix: fix(1) });
    await walk.resetWalk();
    expect(walk.expoLocation.stopLocationUpdatesAsync).toHaveBeenCalled();
    expect(walk.useWalkStore.getState()).toMatchObject({
      walk: { phase: 'off' },
      fix: null,
      weak: false,
      simulated: false,
    });
  });
});
