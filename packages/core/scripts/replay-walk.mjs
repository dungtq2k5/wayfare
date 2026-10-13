#!/usr/bin/env node
// Replays a walk's engine calls through the same @wayfare/core in Node and must reproduce
// every decision the phone made, call for call. Usage:
//   node scripts/replay-walk.mjs <walk-log.jsonl> <places.json>
import { readFileSync } from 'node:fs';
import { replayEngineCalls } from '@wayfare/core';
import { NARRATION_CONFIG } from '@wayfare/contracts';

const [, , logPath, placesPath] = process.argv;
if (logPath === undefined || placesPath === undefined) {
  console.error('usage: node scripts/replay-walk.mjs <walk-log.jsonl> <places.json>');
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

const places = JSON.parse(readFileSync(placesPath, 'utf8')); // NOSONAR: S8707, a developer tool: the paths are the developer's own arguments
const events = readFileSync(logPath, 'utf8') // NOSONAR: S8707, as above
  .trim()
  .split('\n')
  .filter((line) => line.length > 0)
  .map((line) => JSON.parse(line))
  .filter((event) => event.type === 'engineCall');

const mismatches = replayEngineCalls(events, places, config);
for (const m of mismatches) {
  console.error(`✗ t=${m.now} ${m.kind}: phone said ${m.phone}, Node said ${m.node}`);
}

console.log(`${events.length} engine calls replayed, ${mismatches.length} mismatch(es).`);
process.exit(mismatches.length === 0 ? 0 : 1);
