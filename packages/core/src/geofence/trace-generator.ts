import type { LocationFix } from './types';

/** Deterministic PRNG (mulberry32) — no `Math.random` (conventions §3.2), same trace every run. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0; // NOSONAR: S7767, mulberry32 needs the int32 wrap of | 0; Math.trunc does not wrap
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const METRES_PER_DEGREE_LAT = 111_320;

/**
 * A test-only helper (excluded from the build) for authoring a synthetic walk fixture: a straight
 * line at walking speed between two points, with seeded jitter on each sample.
 */
export function generateWalkTrace(options: {
  startT: number;
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  speedMPerS: number;
  intervalMs: number;
  jitterM: number;
  accuracyM: number;
  seed: number;
}): LocationFix[] {
  const { startT, from, to, speedMPerS, intervalMs, jitterM, accuracyM, seed } = options;
  const metresPerDegreeLng = METRES_PER_DEGREE_LAT * Math.cos((from.lat * Math.PI) / 180);
  const dLatM = (to.lat - from.lat) * METRES_PER_DEGREE_LAT;
  const dLngM = (to.lng - from.lng) * metresPerDegreeLng;
  const totalM = Math.hypot(dLatM, dLngM);
  const totalMs = (totalM / speedMPerS) * 1_000;
  const random = seededRandom(seed);

  const trace: LocationFix[] = [];
  for (let elapsedMs = 0; elapsedMs <= totalMs; elapsedMs += intervalMs) {
    const fraction = totalMs === 0 ? 0 : elapsedMs / totalMs;
    const jitterLatM = (random() - 0.5) * 2 * jitterM;
    const jitterLngM = (random() - 0.5) * 2 * jitterM;
    trace.push({
      t: startT + elapsedMs,
      lat: from.lat + (dLatM * fraction + jitterLatM) / METRES_PER_DEGREE_LAT,
      lng: from.lng + (dLngM * fraction + jitterLngM) / metresPerDegreeLng,
      accuracyM,
    });
  }
  return trace;
}
