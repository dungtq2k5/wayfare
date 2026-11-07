import { describe, expect, it } from 'vitest';
import { ListenClock } from './listen-clock';
import { runtimeArea, runtimeLaneDue, RUNTIME_LANE_INTERVAL_MS } from './runtime-lane';
import {
  initialAnalyticsState,
  isCounting,
  newerVersion,
  questionOwed,
  restoreAnalyticsState,
} from './state';

describe('the listening clock', () => {
  it('counts sounded time only: not before the first sound, not while paused', () => {
    const clock = new ListenClock();
    expect(clock.hasSounded).toBe(false);
    expect(clock.sounding(1_000)).toBe(true);
    clock.silent(4_000); // paused after 3 s
    expect(clock.sounding(10_000)).toBe(false);
    expect(clock.listened(12_000)).toBe(5_000);
    clock.silent(12_000);
    clock.silent(13_000);
    expect(clock.listened(20_000)).toBe(5_000);
    expect(clock.hasSounded).toBe(true);
  });
});

describe('the runtime lane', () => {
  const places = [
    { areaId: 'd1', location: { lat: 10.7765, lng: 106.7005 } },
    { areaId: 'd4', location: { lat: 10.7615, lng: 106.7025 } },
  ];

  it('reports the nearest synced Place’s Area within 1 km, or nothing', () => {
    expect(runtimeArea({ lat: 10.762, lng: 106.703 }, places)).toBe('d4');
    expect(runtimeArea({ lat: 10.85, lng: 106.6 }, places)).toBeNull();
  });

  it('reports 15 minutes or more after its last accepted report', () => {
    expect(runtimeLaneDue(null, 0)).toBe(true);
    expect(runtimeLaneDue(0, RUNTIME_LANE_INTERVAL_MS - 1)).toBe(false);
    expect(runtimeLaneDue(0, RUNTIME_LANE_INTERVAL_MS)).toBe(true);
  });
});

describe('the stored state', () => {
  it('a launch raises the known policy to a newer build’s, never lowers it', () => {
    const stored = { ...initialAnalyticsState('2026-09-01'), knownPolicyVersion: '2027-01-01' };
    expect(restoreAnalyticsState(stored, '2026-09-01').knownPolicyVersion).toBe('2027-01-01');
    expect(restoreAnalyticsState(stored, '2027-06-01').knownPolicyVersion).toBe('2027-06-01');
    expect(newerVersion('2026-09-01', '2026-10-01')).toBe('2026-10-01');
  });

  it('counts only an accepted grant on a policy not older than the known one', () => {
    const base = {
      ...initialAnalyticsState('2026-09-01'),
      choice: 'GRANTED' as const,
      policyVersion: '2026-09-01',
      accepted: true,
      current: { id: 'a', createdAt: 0, lastUsedAt: 0 },
    };
    expect(isCounting(base)).toBe(true);
    expect(isCounting({ ...base, accepted: false })).toBe(false);
    expect(isCounting({ ...base, knownPolicyVersion: '2027-01-01' })).toBe(false);
    expect(questionOwed({ ...base, knownPolicyVersion: '2027-01-01', asked: 2 })).toBeNull();
  });
});
