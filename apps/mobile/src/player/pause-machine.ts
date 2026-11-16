import type { PauseReason } from './types';

/** What can change whether the narration is paused. */
export type PauseEvent =
  /** The tourist pressed pause. */
  | { readonly type: 'user-pause' }
  /** The tourist pressed play or *Resume*. */
  | { readonly type: 'user-resume' }
  /** The player reported it stopped or started, which nothing above explains. */
  | { readonly type: 'status'; readonly playing: boolean }
  /** Android said the output is about to turn loud (headphones out). */
  | { readonly type: 'headphones' };

/**
 * Why a narration is paused. A call and another app's music look the same when they begin —
 * playback stops — so both are `system`; a call is told apart only afterwards, when the platform
 * resumes it by itself and the note clears. A pause that is the tourist's, or the headphones',
 * never clears by itself.
 */
export function nextPause(current: PauseReason | null, event: PauseEvent): PauseReason | null {
  switch (event.type) {
    case 'user-pause':
      return 'user';
    case 'user-resume':
      return null;
    case 'headphones':
      return 'headphones';
    case 'status':
      if (event.playing) return current === 'system' ? null : current;
      return current ?? 'system';
  }
}
