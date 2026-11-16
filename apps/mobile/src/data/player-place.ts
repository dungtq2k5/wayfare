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
  /** The card photo's hash, for a downloaded pack's copy. */
  readonly cardPhotoSha256?: string | null;
}
