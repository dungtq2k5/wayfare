import { AudioStatus } from '@wayfare/contracts';

// Widened: statuses are read from storage as plain strings.
const READY: string = AudioStatus.READY;

/** A localization's audio columns (rdm-spec C-4), as any reader holds them. */
export interface AudioColumns {
  readonly sourceContentHash: string;
  readonly audioStatus: string;
  readonly audioSourceContentHash: string | null;
  readonly audioObjectPath: string | null;
  readonly audioSha256: string | null;
  readonly audioBytes: number | null;
  readonly audioDurationMs: number | null;
}

/** Audio a tourist may hear. */
export interface ServedAudio {
  readonly objectPath: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly durationMs: number;
}

/**
 * The row's audio when it was made from the row's own text (rdm-spec C-4): ready, and for the
 * same source hash — so stale text keeps its matching audio, and new text never plays old words.
 * Every reader serves audio through this one rule.
 */
export function servedAudio(row: AudioColumns): ServedAudio | null {
  if (
    row.audioStatus !== READY ||
    row.audioSourceContentHash !== row.sourceContentHash ||
    row.audioObjectPath === null ||
    row.audioSha256 === null
  ) {
    return null;
  }
  return {
    objectPath: row.audioObjectPath,
    sha256: row.audioSha256,
    bytes: row.audioBytes ?? 0,
    durationMs: row.audioDurationMs ?? 0,
  };
}
