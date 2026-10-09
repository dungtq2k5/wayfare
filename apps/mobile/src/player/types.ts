import type { Language } from '@wayfare/contracts';

/** The narration a Place's record carries, when the server has already made it. */
export interface PlaceAudio {
  readonly url: string;
  readonly sha256: string;
  readonly durationMs: number;
}

/** What the player needs to know about a Place — from a synced record or the online detail. */
export interface PlayerPlace {
  readonly id: string;
  readonly name: string;
  /** The text the narration says: the transcript, and what the device voice speaks. */
  readonly text: string;
  /** The language `text` is in; it can differ from the tourist's (the content note says so). */
  readonly textLang: string;
  /** The content tier, for the transcript's note: anything but `REQUESTED` is another language. */
  readonly ownLanguage: boolean;
  readonly categoryCode: string;
  readonly areaId: string | null;
  readonly audio: PlaceAudio | null;
  readonly cardPhotoUrl: string | null;
}

/** Where the sound comes from: the file, the live stream, or the phone's voice. */
export type SourceKind = 'file' | 'stream' | 'device';

/** What the tourist is told when a pause was not their own. */
export type PauseReason = 'user' | 'system' | 'headphones';

export type StartReason = 'manual' | 'auto';

/** One narration, from the moment it was asked for until it ends. */
export interface Narration {
  readonly place: PlayerPlace;
  /** The language it was asked for; a result for any other is dropped (conventions §12.3). */
  readonly lang: Language;
  /** `null` while the ladder is still choosing: *Preparing narration…*. */
  readonly source: SourceKind | null;
  readonly paused: PauseReason | null;
  readonly started: StartReason;
  readonly distanceM: number | null;
  /** Whether the lantern ring still shows (an auto start, for 2 s). */
  readonly ring: boolean;
  /** Both `null` for a source with no timeline: the stream and the device voice. */
  readonly positionMs: number | null;
  readonly durationMs: number | null;
}

/** A quiet line in the mini player's band: a fallback, or a Place with nothing to play. */
export type PlayerNotice =
  | { readonly kind: 'switched'; readonly to: SourceKind }
  | { readonly kind: 'unavailable'; readonly place: PlayerPlace };
