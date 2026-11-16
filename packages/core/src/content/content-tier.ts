import { ContentTier, SOURCE_LANGUAGE } from '@wayfare/contracts';

/** A stored localization of some record (rdm-spec C-4, C-7, C-9). */
export interface LocalizedText {
  readonly lang: string;
  readonly name: string;
  readonly description: string | null;
  readonly sourceContentHash: string;
}

/** The record's own Vietnamese source. */
export interface SourceText {
  readonly name: string;
  readonly description: string | null;
  readonly contentHash: string;
}

/** The text to serve and where it came from. */
export interface ResolvedContent<L extends LocalizedText> {
  readonly tier: ContentTier;
  readonly name: string;
  readonly description: string | null;
  /** The language of the text served. */
  readonly lang: string;
  /** The row's text was made from an older source (rdm-spec §1.5); never true for the source. */
  readonly stale: boolean;
  /** The row served, or null for the source. */
  readonly localization: L | null;
}

const ENGLISH = 'en';

/**
 * The rows `resolveContentTier` can serve `requested` from: its own, then the one it falls back to
 * (null when it falls back to the source alone). A record in that language changes only when one
 * of these rows or the source does, so delta sync versions it by them (rdm-spec §1.7).
 */
export function contentRows(requested: string | null): {
  readonly own: string;
  readonly fallback: string | null;
} {
  if (requested === null || requested === ENGLISH) return { own: ENGLISH, fallback: null };
  if (requested === SOURCE_LANGUAGE) return { own: SOURCE_LANGUAGE, fallback: null };
  return { own: requested, fallback: ENGLISH };
}

/**
 * The one content fallback chain (conventions §11.2): the requested language's row, else the
 * English row, else the Vietnamese source. `requested` is null for a tag Wayfare does not serve.
 * Vietnamese asked for and not yet stored is the source itself — it is already Vietnamese.
 */
export function resolveContentTier<L extends LocalizedText>(input: {
  readonly requested: string | null;
  readonly localizations: readonly L[];
  readonly source: SourceText;
}): ResolvedContent<L> {
  const { requested, localizations, source } = input;
  const row = (lang: string) => localizations.find((candidate) => candidate.lang === lang);
  const served = (tier: ContentTier, localization: L): ResolvedContent<L> => ({
    tier,
    name: localization.name,
    description: localization.description,
    lang: localization.lang,
    stale: localization.sourceContentHash !== source.contentHash,
    localization,
  });

  const own = requested === null ? undefined : row(requested);
  if (own !== undefined) return served(ContentTier.REQUESTED, own);
  const english = requested === SOURCE_LANGUAGE ? undefined : row(ENGLISH);
  if (english !== undefined) return served(ContentTier.ENGLISH, english);
  return {
    tier: requested === SOURCE_LANGUAGE ? ContentTier.REQUESTED : ContentTier.SOURCE,
    name: source.name,
    description: source.description,
    lang: SOURCE_LANGUAGE,
    stale: false,
    localization: null,
  };
}
