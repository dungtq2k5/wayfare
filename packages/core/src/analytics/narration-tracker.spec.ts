import { AnalyticsTrigger, AudioTier } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import type { AnalyticsClient, RecordInput } from './client';
import { NarrationTracker } from './narration-tracker';

function tracker() {
  const recorded: RecordInput[] = [];
  const ended: number[] = [];
  const clock = { now: 0 };
  const client = {
    record: (input: RecordInput) => {
      recorded.push(input);
      return Promise.resolve();
    },
    storyEnded: (ms: number) => {
      ended.push(ms);
      return Promise.resolve();
    },
  } as unknown as AnalyticsClient;
  const settle = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  return {
    tracker: new NarrationTracker(
      () => Promise.resolve(client),
      () => clock.now,
    ),
    recorded,
    ended,
    clock,
    settle,
  };
}

describe('the narration tracker', () => {
  it('starts at the first sound with its trigger and tier, ends with the time that sounded', async () => {
    const { tracker: t, recorded, ended, clock, settle } = tracker();
    t.begin('place', 'ko', AnalyticsTrigger.QR);
    clock.now = 2_000; // preparing
    t.sounding(AudioTier.T2);
    clock.now = 5_000;
    t.silent(); // paused
    clock.now = 9_000;
    t.sounding(AudioTier.T2);
    clock.now = 10_000;
    t.end(true);
    await settle();
    expect(recorded.map((input) => input.type)).toEqual([
      'NARRATION_STARTED',
      'NARRATION_COMPLETED',
    ]);
    expect(recorded[0]).toMatchObject({
      trigger: 'QR',
      audioTier: 'T2',
      narration: { lang: 'ko' },
    });
    expect(recorded[1]).toMatchObject({ listenMs: 4_000 });
    expect(ended).toEqual([4_000]);
  });

  it('records nothing for a story that never sounded; a new one abandons the last', async () => {
    const { tracker: t, recorded, ended, settle } = tracker();
    t.begin('quiet', 'en', AnalyticsTrigger.TAP);
    t.begin('next', 'en', AnalyticsTrigger.GEOFENCE);
    t.sounding(AudioTier.T1);
    t.begin('third', 'en', AnalyticsTrigger.TAP);
    t.end(false);
    await settle();
    expect(recorded.map((input) => input.type)).toEqual([
      'NARRATION_STARTED',
      'NARRATION_ABANDONED',
    ]);
    expect(ended).toEqual([0, 0, 0]);
  });
});
