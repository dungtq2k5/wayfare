import { NARRATION_CONFIG } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import {
  afterPrefetch,
  backoffMs,
  mayPrefetch,
  openGate,
  planPrefetch,
  PREFETCH_RADIUS_M,
} from './prefetch';

const here = { lat: 10.77, lng: 106.7 };
// ~111 m per 0.001° of latitude.
const at = (id: string, metres: number, hasAudio = true) => ({
  id,
  location: { lat: here.lat + metres / 111_000, lng: here.lng },
  hasAudio,
});

describe('planPrefetch', () => {
  it('takes the nearest three unheard Places within 1.5 km', () => {
    const plan = planPrefetch({
      from: here,
      heard: new Set(['b']),
      places: [
        at('a', 900),
        at('b', 100),
        at('c', 300),
        at('d', 1_400),
        at('e', 600),
        at('far', 2_000),
      ],
    });
    expect([...plan.download, ...plan.ask].sort((a, b) => a.localeCompare(b))).toEqual([
      'a',
      'c',
      'e',
    ]);
  });

  it('asks for the ones with no audio and downloads the others', () => {
    const plan = planPrefetch({
      from: here,
      heard: new Set(),
      places: [at('a', 100, false), at('b', 200, true)],
    });
    expect(plan).toEqual({ ask: ['a'], download: ['b'] });
  });

  it('plans nothing when every Place is out of reach', () => {
    expect(
      planPrefetch({ from: here, heard: new Set(), places: [at('x', PREFETCH_RADIUS_M + 200)] }),
    ).toEqual({ ask: [], download: [] });
  });
});

describe('the gate', () => {
  it('waits the floor between runs', () => {
    const gate = afterPrefetch(1_000, false, openGate);
    expect(mayPrefetch(gate, 1_000 + NARRATION_CONFIG.prefetchMinIntervalMs - 1, true)).toBe(false);
    expect(mayPrefetch(gate, 1_000 + NARRATION_CONFIG.prefetchMinIntervalMs, true)).toBe(true);
  });

  it('runs nothing offline', () => {
    expect(mayPrefetch(openGate, 5_000, false)).toBe(false);
  });

  it('backs off 30 s, 60 s, 120 s and doubles up to the cap on 429', () => {
    expect([1, 2, 3, 4, 5, 6, 9].map(backoffMs)).toEqual([
      30_000, 60_000, 120_000, 240_000, 480_000, 600_000, 600_000,
    ]);
  });

  it('clears the streak after a success', () => {
    const throttled = afterPrefetch(0, true, afterPrefetch(0, true, openGate));
    expect(throttled.throttled).toBe(2);
    expect(afterPrefetch(0, false, throttled).throttled).toBe(0);
  });
});
