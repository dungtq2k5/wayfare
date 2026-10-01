#!/usr/bin/env node
// Replays a walk's engine calls through the same @wayfare/core in Node and must reproduce
// every decision the phone made, call for call (check 5). Usage:
//   node scripts/replay.mjs <walk-log.jsonl> <places.json>
import { readFileSync } from 'node:fs';
import { evaluateGeofences, initialGeofenceState, reconcile } from '@wayfare/core';
import { NARRATION_CONFIG } from '@wayfare/contracts';

const [, , logPath, placesPath] = process.argv;
if (logPath === undefined || placesPath === undefined) {
  console.error('usage: node scripts/replay.mjs <walk-log.jsonl> <places.json>');
  process.exit(1);
}

const config = {
  geofenceDebounceMs: NARRATION_CONFIG.geofenceDebounceMs,
  narrationCooldownMs: NARRATION_CONFIG.narrationCooldownMs,
  commercialNarrationWindowMs: NARRATION_CONFIG.commercialNarrationWindowMs,
  commercialNarrationsPerWindow: NARRATION_CONFIG.commercialNarrationsPerWindow,
  safetyReconcileIntervalMs: NARRATION_CONFIG.safetyReconcileIntervalMs,
  locateMaxAccuracyM: NARRATION_CONFIG.locateMaxAccuracyM,
  gpsGapMs: NARRATION_CONFIG.gpsGapMs,
};

const places = JSON.parse(readFileSync(placesPath, 'utf8'));
const events = readFileSync(logPath, 'utf8')
  .trim()
  .split('\n')
  .filter((line) => line.length > 0)
  .map((line) => JSON.parse(line))
  .filter((event) => event.type === 'engineCall');

let state = initialGeofenceState();
let mismatches = 0;

for (const event of events) {
  const result =
    event.kind === 'evaluate'
      ? evaluateGeofences({
          now: event.now,
          fix: {
            t: event.now,
            lat: event.fix.lat,
            lng: event.fix.lng,
            accuracyM: event.fix.accuracyM,
          },
          places,
          state,
          config,
        })
      : reconcile({ now: event.now, places, state, config });
  state = result.state;
  const got = result.decision?.placeId ?? null;
  if (got !== event.decision) {
    mismatches += 1;
    console.error(`✗ t=${event.now} ${event.kind}: phone said ${event.decision}, Node said ${got}`);
  }
}

console.log(`${events.length} engine calls replayed, ${mismatches} mismatch(es).`);
process.exit(mismatches === 0 ? 0 : 1);
