import { describe, expect, it } from 'vitest';
import { ActivationGate } from './activation-gate';

const CURRENT = 'a'.repeat(64);
const OLD = 'b'.repeat(64);
const requested = { contentHash: CURRENT, activationRequestedAt: new Date() };
const ready = { sourceContentHash: CURRENT, audioStatus: 'READY', audioSourceContentHash: CURRENT };

describe('ActivationGate.evaluate', () => {
  it('opens when text and audio are current and activation was requested', () => {
    expect(ActivationGate.evaluate({ place: requested, enLocalization: ready })).toEqual({
      open: true,
      missing: [],
    });
  });

  it('waits for everything when there is no en row', () => {
    expect(ActivationGate.evaluate({ place: requested, enLocalization: null })).toEqual({
      open: false,
      missing: ['en.text', 'en.audio'],
    });
  });

  it('treats stale text as missing', () => {
    expect(
      ActivationGate.evaluate({
        place: requested,
        enLocalization: { ...ready, sourceContentHash: OLD },
      }).missing,
    ).toEqual(['en.text']);
  });

  it('treats audio for an older hash as missing', () => {
    expect(
      ActivationGate.evaluate({
        place: requested,
        enLocalization: { ...ready, audioSourceContentHash: OLD },
      }).missing,
    ).toEqual(['en.audio']);
  });

  it.each(['PENDING', 'FAILED'])('treats %s audio as missing', (audioStatus) => {
    expect(
      ActivationGate.evaluate({ place: requested, enLocalization: { ...ready, audioStatus } })
        .missing,
    ).toEqual(['en.audio']);
  });

  it('stays closed until activation is requested', () => {
    expect(
      ActivationGate.evaluate({
        place: { ...requested, activationRequestedAt: null },
        enLocalization: ready,
      }),
    ).toEqual({ open: false, missing: ['activation'] });
  });
});
