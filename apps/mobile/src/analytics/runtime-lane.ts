import { analyticsActivity } from '@wayfare/api-client';
import { runtimeArea, runtimeLaneDue, RUNTIME_LANE_RADIUS_M } from '@wayfare/core';
import { AppState } from 'react-native';
import { databaseReady } from '../data/boot';
import { useLocationStore } from '../location/location-store';
import { useWalkStore } from '../walk/store';

/** How often the lane looks whether it's time to report. */
const CHECK_EVERY_MS = 60_000;

/** A position older than this says nothing about where the phone is now. */
const FRESH_MS = 5 * 60 * 1000;

/** About 1 km of latitude, the box the nearby Places are read from before measuring. */
const DEGREES = (RUNTIME_LANE_RADIUS_M / 111_000) * 1.2;

let lastAccepted: number | null = null;
let started = false;

/** The phone's latest fresh position — the walk's fix or the Map's. */
function freshPosition(now: number): { lat: number; lng: number } | null {
  const fix = useWalkStore.getState().fix;
  if (fix !== null && now - fix.t <= FRESH_MS) return { lat: fix.lat, lng: fix.lng };
  const shown = useLocationStore.getState().position;
  if (shown?.at !== undefined && now - shown.at <= FRESH_MS) return shown;
  return null;
}

/**
 * The consent-free runtime lane (rdm-spec A-5): while the app is in front or a walk is running, at
 * most once per 15 minutes since its last accepted report, the Area of the nearest synced Place
 * within 1 km — never a position. A refusal or a failure is dropped, never queued.
 */
export async function reportActivity(now: number = Date.now()): Promise<void> {
  const { phase } = useWalkStore.getState().walk;
  const walking = phase === 'on' || phase === 'foreground-only';
  if (AppState.currentState !== 'active' && !walking) return;
  if (!runtimeLaneDue(lastAccepted, now)) return;
  const position = freshPosition(now);
  if (position === null) return;
  const db = await databaseReady;
  const rows = await db.all<{ area_id: string; lat: number; lng: number }>(
    `SELECT DISTINCT place_id, area_id, lat, lng FROM place_records
     WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`,
    [
      position.lat - DEGREES,
      position.lat + DEGREES,
      position.lng - DEGREES,
      position.lng + DEGREES,
    ],
  );
  const areaId = runtimeArea(
    position,
    rows.map((row) => ({ areaId: row.area_id, location: { lat: row.lat, lng: row.lng } })),
  );
  if (areaId === null) return;
  try {
    await analyticsActivity({ areaId });
    lastAccepted = now;
  } catch {
    // Dropped: the lane is a count of who is out now, never a backlog.
  }
}

/** Starts the lane once for the app's life. */
export function startRuntimeLane(): void {
  if (started) return;
  started = true;
  setInterval(() => void reportActivity().catch(() => undefined), CHECK_EVERY_MS);
  AppState.addEventListener('change', (next) => {
    if (next === 'active') void reportActivity().catch(() => undefined);
  });
}
