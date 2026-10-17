import { NARRATION_CONFIG } from '@wayfare/contracts';
import { colors } from '@wayfare/design-tokens/tokens';
import type { GeofenceConfig, LocationFix } from '@wayfare/core';
import * as Location from 'expo-location';
import { AppState } from 'react-native';
import { databaseReady } from '../data/boot';
import { tourist } from '../i18n';
import { WALK_IDLE_MS, WALK_UNDO_MS } from '../env';
import { narrationPlayer } from '../player/narration-player';
import { usePlayerStore } from '../player/store';
import { playerPlaceOf, viewFromRecord } from '../places/place-view';
import { handleFix } from './handler';
import type { OfferOutcome } from './handler';
import { loadWalkPlaces, walkPlaces } from './geofence-places';
import { markHeard } from '../data/heard';
import { walkLog } from './log';
import { initialWalk, step } from './machine';
import type { WalkEffect, WalkEvent } from './machine';
import { gapMsFor, stepMotion, stoppedBySystem } from './motion';
import type { Cadence } from './motion';
import { notifyWalkEnded } from './notifications';
import { runPrefetch } from './prefetch-run';
import { loadWalk, saveWalk } from './records';
import { useWalkStore } from './store';

/** The TaskManager task the location updates feed (defined at module scope in `task.ts`). */
export const WALK_TASK = 'wayfare-walk-location';

const UNDO_MS = WALK_UNDO_MS ?? NARRATION_CONFIG.walkUndoMs;

/** No fix for this long means the walk was not running: four of the slowest cadence's intervals. */
const SYSTEM_STOP_SILENCE_MS = 4 * NARRATION_CONFIG.stationaryIntervalMs;
const state = () => useWalkStore.getState();
const set = useWalkStore.setState;

const motionConfig = () => ({
  walkIdleStopMs: WALK_IDLE_MS ?? NARRATION_CONFIG.walkIdleStopMs,
  walkIdleRadiusM: NARRATION_CONFIG.walkIdleRadiusM,
  stationaryAfterMs: state().stationaryMode
    ? NARRATION_CONFIG.stationaryAfterMs
    : Number.POSITIVE_INFINITY,
  locateMaxAccuracyM: NARRATION_CONFIG.locateMaxAccuracyM,
});
const geofenceConfig: GeofenceConfig = {
  geofenceDebounceMs: NARRATION_CONFIG.geofenceDebounceMs,
  narrationCooldownMs: NARRATION_CONFIG.narrationCooldownMs,
  commercialNarrationWindowMs: NARRATION_CONFIG.commercialNarrationWindowMs,
  commercialNarrationsPerWindow: NARRATION_CONFIG.commercialNarrationsPerWindow,
  safetyReconcileIntervalMs: NARRATION_CONFIG.safetyReconcileIntervalMs,
  locateMaxAccuracyM: NARRATION_CONFIG.locateMaxAccuracyM,
  gpsGapMs: NARRATION_CONFIG.gpsGapMs,
};

const isRunning = () => state().walk.phase === 'on' || state().walk.phase === 'foreground-only';

// ——— the walk record ———

let saving: Promise<void> = Promise.resolve();
function persist(): void {
  const walk = state().walk;
  saving = saving.then(async () => saveWalk(await databaseReady, walk)).catch(() => undefined);
}

let settleTimer: ReturnType<typeof setTimeout> | undefined;

/** Applies an event to the walk: the machine decides, this carries out what it asks for. */
export function dispatch(event: WalkEvent): void {
  const before = state().walk;
  const result = step(before, event, Date.now(), UNDO_MS);
  if (result.walk !== before) {
    set({ walk: result.walk });
    persist();
    if (event.type !== 'engine' && event.type !== 'heard') {
      void walkLog.append({
        type: 'walk',
        event: event.type,
        phase: result.walk.phase,
        endReason: result.walk.endReason,
        at: Date.now(),
      });
    }
  }
  for (const effect of result.effects) void carryOut(effect);
}

async function carryOut(effect: WalkEffect): Promise<void> {
  switch (effect) {
    case 'start-updates':
      set({ motion: { anchor: null, cadence: 'moving' }, retry: [], noPosition: false });
      await startUpdates('moving');
      break;
    case 'stop-updates':
      await stopUpdates();
      break;
    case 'idle-notification':
      await notifyWalkEnded(state().walk.heard.length);
      break;
    case 'end-notification':
      break;
  }
}

// ——— the location updates ———

const intervalFor = (cadence: Cadence) =>
  cadence === 'moving' ? NARRATION_CONFIG.gpsThrottleMs : NARRATION_CONFIG.stationaryIntervalMs;

let restarting: Promise<void> = Promise.resolve();

/** Changes of cadence queue up: two restarts must never interleave. */
function startUpdates(cadence: Cadence): Promise<void> {
  restarting = restarting.then(() => applyUpdates(cadence));
  return restarting;
}

async function applyUpdates(cadence: Cadence): Promise<void> {
  if (state().simulated) return;
  const { t } = tourist();
  set({ intervalMs: intervalFor(cadence) });
  try {
    // Android refuses to start a foreground service while the app is in the background, and a restart
    // asks for it again (checked on a phone: "Foreground service cannot be started when the
    // application is in the background"). So a change of cadence from the background re-registers the
    // updates without the service option, which keeps the one already running (its text is fixed).
    const running = await Location.hasStartedLocationUpdatesAsync(WALK_TASK);
    const withService =
      state().walk.phase === 'on' && (!running || AppState.currentState === 'active');
    await Location.startLocationUpdatesAsync(WALK_TASK, {
      accuracy: cadence === 'moving' ? Location.Accuracy.High : Location.Accuracy.Balanced,
      timeInterval: intervalFor(cadence),
      distanceInterval: 0,
      ...(withService
        ? {
            foregroundService: {
              notificationTitle: t('walk.notification.title'),
              notificationBody: t('walk.notification.body'),
              notificationColor: colors.light.primary,
              killServiceOnDestroy: false,
            },
          }
        : {}),
    });
  } catch (error) {
    // The walk stays marked on; the next launch finds no task and says so (W17).
    void walkLog.append({
      type: 'error',
      where: 'startUpdates',
      message: String(error),
      at: Date.now(),
    });
  }
}

async function stopUpdates(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(WALK_TASK)) {
      await Location.stopLocationUpdatesAsync(WALK_TASK);
    }
  } catch {
    // Already stopped.
  }
}

// ——— a fix ———

/** Fixes are handled one at a time, in the order they arrived. */
let handling: Promise<void> = Promise.resolve();
let handledSeq = 0;
let prefetching = false;

function offerToPlayer(placeId: string, distanceM: number): OfferOutcome {
  const record = walkPlaces().records.get(placeId);
  if (record === undefined) return 'skipped';
  const result = narrationPlayer.offer(playerPlaceOf(viewFromRecord(record)), { distanceM });
  return result === 'refused' ? 'refused' : 'accepted';
}

async function onFix(fix: LocationFix): Promise<void> {
  if (!isRunning()) return;
  const current = state();
  await loadWalkPlaces(fix.t);

  const motion = stepMotion(current.motion, fix, motionConfig());
  set({ motion: motion.state, noPosition: false });
  if (motion.idle) {
    dispatch({ type: 'idle' });
    return;
  }
  if (motion.cadenceChanged) void startUpdates(motion.state.cadence);

  const result = handleFix({
    fix,
    now: fix.t,
    intervalMs: current.intervalMs,
    config: geofenceConfig,
    state: { engine: current.walk.engine, retry: current.retry },
    deps: {
      places: () => walkPlaces().geofence,
      offer: offerToPlayer,
      log: (call) => {
        if (call.decision !== null) set((s) => ({ decisions: s.decisions + 1 }));
        void walkLog.append(call);
      },
    },
  });
  set({ retry: result.state.retry, weak: result.weak });
  dispatch({ type: 'engine', engine: result.state.engine });

  if (!prefetching) {
    prefetching = true;
    void runPrefetch(fix, Date.now()).finally(() => {
      prefetching = false;
    });
  }
}

/** Runs the engine for every fix the task or the simulation has handed on. */
function onStore(): void {
  const { fix, fixSeq, fixSimulated, simulated } = state();
  if (fix === null || fixSeq === handledSeq) return;
  handledSeq = fixSeq;
  // A simulated walk listens to the simulation only; a real one ignores it.
  if (fixSimulated !== simulated) return;
  handling = handling.then(() => onFix(fix)).catch(() => undefined);
}

/** Resolves once every fix handed on so far has been handled (the simulation steps by it). */
export const settled = (): Promise<void> => handling;

// ——— heard, and problems ———

function onNarrationStart(placeId: string): void {
  const now = Date.now();
  void markHeard(placeId, now);
  dispatch({ type: 'heard', placeId });
  void walkLog.append({ type: 'narration', placeId, at: now });
}

let poll: ReturnType<typeof setInterval> | undefined;

/** While the app is in front: *no position* when the fixes stop, *location off* when it is off. */
async function checkProblems(): Promise<void> {
  const current = state();
  if (!isRunning() || current.simulated || AppState.currentState !== 'active') return;
  const lastAt = current.fix?.t ?? current.walk.startedAt ?? Date.now();
  const gap = gapMsFor(NARRATION_CONFIG.gpsGapMs, current.intervalMs);
  const noPosition = Date.now() - lastAt > gap;
  let locationOff = current.locationOff;
  try {
    locationOff = !(await Location.hasServicesEnabledAsync());
  } catch {
    // Keep the last answer.
  }
  if (noPosition !== current.noPosition || locationOff !== current.locationOff) {
    set({ noPosition, locationOff });
  }
}

// ——— what the screens call ———

/** Stops the walk at once; *Undo* has `walkUndoMs` to bring it back. */
export function stopWalk(): void {
  if (!isRunning()) return;
  dispatch({ type: 'stop' });
  // The narration playing finishes; the Place waiting in *Up next* was the walk's choice.
  usePlayerStore.setState({ next: null });
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => dispatch({ type: 'settle' }), UNDO_MS);
}

export function undoStop(): void {
  clearTimeout(settleTimer);
  dispatch({ type: 'undo' });
}

/** Moves a running walk between full and foreground-only as the permission changes (E3). */
export function applyBackgroundPermission(granted: boolean): void {
  const phase = state().walk.phase;
  if (granted && phase === 'foreground-only') {
    set({ revokedNotice: false });
    dispatch({ type: 'background-granted' });
    void startUpdates(state().motion.cadence);
  } else if (!granted && phase === 'on') {
    set({ revokedNotice: true });
    dispatch({ type: 'background-revoked' });
    void startUpdates(state().motion.cadence);
  }
}

// ——— launch ———

let installed = false;

/** Wires the subscribers once; safe to call from the task file and from the app. */
export function installWalk(): void {
  if (installed) return;
  installed = true;
  useWalkStore.subscribe(onStore);
  usePlayerStore.subscribe((player, previous) => {
    const id = player.current?.place.id;
    if (id !== undefined && id !== previous.current?.place.id) onNarrationStart(id);
  });
  poll = setInterval(() => void checkProblems(), 5_000);
  // Coming back from the phone's settings is when a permission changes (E3, W3b).
  AppState.addEventListener('change', (next) => {
    if (next !== 'active' || !isRunning()) return;
    void Location.getBackgroundPermissionsAsync().then(({ granted }) => {
      applyBackgroundPermission(granted);
    });
  });
}

let hydrating: Promise<void> | null = null;

/** Reads the kept walk at launch (once); a walk marked on whose task is gone was stopped by the phone. */
export function hydrateWalk(): Promise<void> {
  hydrating ??= readWalk();
  return hydrating;
}

async function readWalk(): Promise<void> {
  const db = await databaseReady;
  let walk = await loadWalk(db);
  set({ walk, hydrated: true });
  if (walk.phase === 'on' || walk.phase === 'foreground-only') {
    let started = false;
    try {
      started = await Location.hasStartedLocationUpdatesAsync(WALK_TASK);
    } catch {
      started = false;
    }
    const killed = stoppedBySystem({
      taskRunning: started,
      lastFixAt: walk.lastFixAt,
      now: Date.now(),
      silenceMs: SYSTEM_STOP_SILENCE_MS,
    });
    if (killed) {
      dispatch({ type: 'killed' });
      // The task manager may have restarted the updates on its own; the walk is over.
      await stopUpdates();
    } else {
      set({ intervalMs: intervalFor(state().motion.cadence) });
    }
  } else if (walk.phase === 'ended' && walk.endReason === 'stopped') {
    // The Undo window did not survive the launch: the walk is over.
    walk = initialWalk();
    set({ walk });
    persist();
  } else if (walk.phase === 'starting') {
    set({ walk: initialWalk() });
    persist();
  }
}

/** *Forget this install*: the walk stops and its record, heard Places and log are gone. */
export async function resetWalk(): Promise<void> {
  clearTimeout(settleTimer);
  await stopUpdates();
  set({
    walk: initialWalk(),
    fix: null,
    retry: [],
    weak: false,
    noPosition: false,
    locationOff: false,
    simulated: false,
  });
}

/** For a spec: tears the interval down. */
export function disposeWalk(): void {
  clearInterval(poll);
}
