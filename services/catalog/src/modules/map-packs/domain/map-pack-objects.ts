import type { MapPackObject } from '@wayfare/contracts';

/** `map_packs.assets` (rdm-spec C-14): the style and every glyph range and sprite file. */
export interface MapPackAssets {
  readonly style: MapPackObject;
  readonly files: readonly MapPackObject[];
}

/** The columns a pack's objects are read from. */
export interface StoredMapPack {
  readonly pmtilesObjectPath: string;
  readonly pmtilesSha256: string;
  readonly pmtilesBytes: bigint;
  readonly assets: unknown;
}

/** Every object of a pack: the archive, the style, then the files. */
export function objectsOf(pack: StoredMapPack): MapPackObject[] {
  const assets = pack.assets as MapPackAssets;
  return [
    { path: pack.pmtilesObjectPath, sha256: pack.pmtilesSha256, bytes: Number(pack.pmtilesBytes) },
    assets.style,
    ...assets.files,
  ];
}

/** What a pack weighs: the archive and its assets together (`MAX_MAP_PACK_BYTES`). */
export function packBytes(objects: readonly MapPackObject[]): number {
  return objects.reduce((sum, object) => sum + object.bytes, 0);
}
