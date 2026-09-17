import { AudioStatus } from '@wayfare/contracts';

// Widened: statuses are read from the database as plain strings.
const READY: string = AudioStatus.READY;

/** What the gate may still wait for. */
export type GateMissing = 'en.text' | 'en.audio' | 'activation';

/** The Place side of the gate. */
export interface GatePlace {
  readonly contentHash: string;
  readonly activationRequestedAt: Date | null;
}

/** The `en` localization, when one exists. */
export interface GateLocalization {
  readonly sourceContentHash: string;
  readonly audioStatus: string;
  readonly audioSourceContentHash: string | null;
}

/** The outcome, and the pieces still missing in a fixed order. */
export interface GateResult {
  readonly open: boolean;
  readonly missing: GateMissing[];
}

/**
 * The activation gate, implemented once (rdm-spec §1.6): the `en` text and audio are both ready for
 * the current `content_hash`, and publication was requested. Called only by the localization
 * consumer and `RequestActivation`.
 */
export const ActivationGate = {
  evaluate(input: {
    readonly place: GatePlace;
    readonly enLocalization: GateLocalization | null;
  }): GateResult {
    const { place, enLocalization: en } = input;
    const missing: GateMissing[] = [];
    if (en === null || en.sourceContentHash !== place.contentHash) missing.push('en.text');
    if (
      en === null ||
      en.audioStatus !== READY ||
      en.audioSourceContentHash !== place.contentHash
    ) {
      missing.push('en.audio');
    }
    if (place.activationRequestedAt === null) missing.push('activation');
    return { open: missing.length === 0, missing };
  },
};
