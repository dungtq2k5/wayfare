import { NARRATION_CONFIG } from '@wayfare/contracts';
import type { PlaceSyncRecord } from '@wayfare/contracts';
import { evaluateGeofences, initialGeofenceState, reconcile, wakeUpRegions } from '@wayfare/core';
import type { GeofenceConfig, GeofenceState, LocationFix } from '@wayfare/core';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { File } from 'expo-file-system';
import { AUDIO_DIR, ENGINE_STATE_FILE, PLACES_FILE } from './config';
import { log, startBatterySampling } from './log';
import { NarrationPlayer } from './player';

export const LOCATION_TASK = 'wayfare-spike-location';
export const GEOFENCE_TASK = 'wayfare-spike-geofence';

/** The engine's tunables, from `NARRATION_CONFIG` — never hard-coded (conventions §12.3). */
const config: GeofenceConfig = {
  geofenceDebounceMs: NARRATION_CONFIG.geofenceDebounceMs,
  narrationCooldownMs: NARRATION_CONFIG.narrationCooldownMs,
  commercialNarrationWindowMs: NARRATION_CONFIG.commercialNarrationWindowMs,
  commercialNarrationsPerWindow: NARRATION_CONFIG.commercialNarrationsPerWindow,
  safetyReconcileIntervalMs: NARRATION_CONFIG.safetyReconcileIntervalMs,
  locateMaxAccuracyM: NARRATION_CONFIG.locateMaxAccuracyM,
  gpsGapMs: NARRATION_CONFIG.gpsGapMs,
};

const player = new NarrationPlayer();
let places: readonly PlaceSyncRecord[] = [];
let placesById = new Map<string, PlaceSyncRecord>();

function loadPlaces(): readonly PlaceSyncRecord[] {
  if (places.length === 0 && PLACES_FILE.exists) {
    places = JSON.parse(PLACES_FILE.textSync()) as PlaceSyncRecord[];
    placesById = new Map(places.map((place) => [place.id, place]));
  }
  return places;
}

function loadState(): GeofenceState {
  if (!ENGINE_STATE_FILE.exists) return initialGeofenceState();
  return JSON.parse(ENGINE_STATE_FILE.textSync()) as GeofenceState;
}

function saveState(state: GeofenceState): void {
  ENGINE_STATE_FILE.write(JSON.stringify(state));
}

function onDecision(placeId: string): void {
  const place = placesById.get(placeId);
  player.narrate(placeId, place?.localization.name ?? placeId);
}

/** Read the fix, call `evaluateGeofences`, write the state back, hand a decision to the player. */
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error !== null) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  const activePlaces = loadPlaces();
  let state = loadState();
  for (const location of locations) {
    const fix: LocationFix = {
      t: location.timestamp,
      lat: location.coords.latitude,
      lng: location.coords.longitude,
      accuracyM: location.coords.accuracy ?? config.locateMaxAccuracyM,
    };
    const result = evaluateGeofences({ now: fix.t, fix, places: activePlaces, state, config });
    state = result.state;
    log({
      type: 'engineCall',
      kind: 'evaluate',
      now: fix.t,
      fix: { lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM },
      decision: result.decision?.placeId ?? null,
    });
    if (result.decision !== null) onDecision(result.decision.placeId);
  }
  saveState(state);
});

/** The OS wake-up net. Observed only — W4 records whether it brings the app back. */
TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
  if (error !== null) return;
  const { eventType, region } = data as {
    eventType: Location.LocationGeofencingEventType;
    region: Location.LocationRegion;
  };
  log({
    type: 'appState',
    state: `geofence ${Location.LocationGeofencingEventType[eventType]} ${region.identifier ?? ''}`,
  });
});

let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let battery: { stop: () => void } | null = null;

/** §6 build sequence: register the tasks, start the foreground reconcile timer and battery sampling. */
export async function startWalk(): Promise<string> {
  const activePlaces = loadPlaces();
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: NARRATION_CONFIG.gpsThrottleMs,
    distanceInterval: 5,
    activityType: Location.ActivityType.Fitness,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Wayfare spike',
      notificationBody: 'Walking the pilot route',
    },
  });

  // Right after the request: did the OS register it, and is the task defined in this JS context?
  const providers = await Location.getProviderStatusAsync();
  const diagnosis =
    `hasStarted=${String(await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK))} ` +
    `taskDefined=${String(TaskManager.isTaskDefined(LOCATION_TASK))} ` +
    `servicesEnabled=${String(await Location.hasServicesEnabledAsync())} ` +
    `providers=${JSON.stringify(providers)}`;
  log({ type: 'diag', message: diagnosis });

  const lastFix = loadState().lastFix;
  if (lastFix !== null) {
    const regions = wakeUpRegions(lastFix, activePlaces, 90).map((region) => ({
      identifier: region.id,
      latitude: region.location.lat,
      longitude: region.location.lng,
      radius: region.triggerRadiusM,
    }));
    if (regions.length > 0) await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
  }

  await player.configure();
  battery = startBatterySampling();
  reconcileTimer = setInterval(() => {
    const now = Date.now();
    const result = reconcile({ now, places: loadPlaces(), state: loadState(), config });
    saveState(result.state);
    log({ type: 'engineCall', kind: 'reconcile', now, decision: result.decision?.placeId ?? null });
    if (result.decision !== null) onDecision(result.decision.placeId);
  }, config.safetyReconcileIntervalMs);
  return diagnosis;
}

/** Plays the first Place's audio with the screen on, so "no fix" and "no audio" can be told apart. */
export async function testNarration(): Promise<string> {
  const [first] = loadPlaces();
  if (first === undefined) return 'no Places — download first';
  const file = new File(AUDIO_DIR, `${first.id}.mp3`);
  if (!file.exists) return `no audio file for ${first.localization.name}`;
  await player.configure();
  onDecision(first.id);
  return `narrating ${first.localization.name} (${file.size} bytes)`;
}

export async function stopWalk(): Promise<void> {
  if (reconcileTimer !== null) clearInterval(reconcileTimer);
  battery?.stop();
  if (await TaskManager.isTaskRegisteredAsync(LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
  if (await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK)) {
    await Location.stopGeofencingAsync(GEOFENCE_TASK);
  }
}
