import type { StoredAudio } from './ladder';

/** One story the player can play: a Place's text in one language, and its audio if made. */
export interface Track {
  readonly placeId: string;
  readonly code: string;
  readonly name: string;
  readonly categoryCode: string;
  readonly areaCode: string | null;
  readonly photoUrl: string | null;
  /** The language the story is told in: the text's own (WQ3 names it when it isn't the page's). */
  readonly lang: string;
  /** The transcript. */
  readonly text: string;
  readonly audio: StoredAudio | null;
}

/** `m:ss` for a duration in milliseconds. */
export function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
