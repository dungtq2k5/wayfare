import type { MapPackObject } from '@wayfare/contracts';

/**
 * `map_packs.assets` (rdm-spec C-14): the style, the dark style when the pack has one, and every
 * glyph range and sprite file (the dark flavour's sprites among them).
 */
export interface MapPackAssets {
  readonly style: MapPackObject;
  readonly styleDark?: MapPackObject;
  readonly files: readonly MapPackObject[];
}

/** A pack's objects by role. */
export interface MapPackParts {
  readonly pmtiles: MapPackObject;
  readonly style: MapPackObject;
  /** Null for a pack published before there was a dark flavour: it is drawn light only. */
  readonly styleDark: MapPackObject | null;
  readonly files: readonly MapPackObject[];
}

/** The columns a pack's objects are read from. */
export interface StoredMapPack {
  readonly pmtilesObjectPath: string;
  readonly pmtilesSha256: string;
  readonly pmtilesBytes: bigint;
  readonly assets: unknown;
}

/** A pack's objects by role. */
export function partsOf(pack: StoredMapPack): MapPackParts {
  const assets = pack.assets as MapPackAssets;
  return {
    pmtiles: {
      path: pack.pmtilesObjectPath,
      sha256: pack.pmtilesSha256,
      bytes: Number(pack.pmtilesBytes),
    },
    style: assets.style,
    styleDark: assets.styleDark ?? null,
    files: assets.files,
  };
}

/** Every object of a pack, to verify, weigh or delete: the archive, the styles, then the files. */
export function objectsOf(pack: StoredMapPack): MapPackObject[] {
  const parts = partsOf(pack);
  return [
    parts.pmtiles,
    parts.style,
    ...(parts.styleDark === null ? [] : [parts.styleDark]),
    ...parts.files,
  ];
}

/** What a pack weighs: the archive and its assets together (`MAX_MAP_PACK_BYTES`). */
export function packBytes(objects: readonly MapPackObject[]): number {
  return objects.reduce((sum, object) => sum + object.bytes, 0);
}
