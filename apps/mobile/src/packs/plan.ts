import type { OfflineAsset, OfflineManifest, OfflineMapPack } from '@wayfare/contracts';

/** What a pack file is, in the order a download fetches them (product §F5). */
export const FILE_KINDS = ['map', 'places', 'photo', 'audio'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/** The language of the files every pack of an area shares: the map and the card photos. */
export const SHARED = '';

/** One file of a pack, as its row holds it; `name` is its path under the area's pack folder. */
export interface PackFile {
  readonly areaId: string;
  readonly lang: string;
  readonly kind: FileKind;
  readonly name: string;
  readonly url: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly placeId: string | null;
  readonly verified: boolean;
}

/** Where a pack's map lives on the phone, for drawing it (the style's prefix swapped). */
export interface PackMap {
  readonly version: number;
  /** The URL prefix every file of the published pack shares; the styles name files under it. */
  readonly prefixUrl: string;
  /** The map's folder under the area's pack folder. */
  readonly folder: string;
  readonly style: string;
  readonly styleDark: string | null;
}

/** A relative path the server named, safe to write: no empty, `.` or `..` part, plain characters. */
export function safeRelative(path: string): boolean {
  return (
    /^[A-Za-z0-9._\-/ @]+$/.test(path) &&
    path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  );
}

/** A URL's file extension, kept so the file opens as what it is (".jpg", ".mp3"); empty if odd. */
function extensionOf(url: string): string {
  const last = new URL(url).pathname.split('/').pop() ?? '';
  const match = /\.[a-z0-9]{1,5}$/i.exec(last);
  return match === null ? '' : match[0].toLowerCase();
}

/** The published map pack's prefix: the folder its archive sits in. */
function mapPrefix(pack: OfflineMapPack): string {
  const path = pack.pmtiles.path;
  return path.slice(0, path.lastIndexOf('/') + 1);
}

/** The map pack's files, keeping their path relative to its prefix, under `map/<version>/`. */
export function mapFiles(
  areaId: string,
  pack: OfflineMapPack,
): { files: PackFile[]; map: PackMap } {
  const prefix = mapPrefix(pack);
  const folder = `map/${pack.version}`;
  const relative = (asset: OfflineAsset): string => {
    const rel = asset.path.slice(prefix.length);
    if (!asset.path.startsWith(prefix) || !safeRelative(rel)) {
      throw new Error(`Unsafe map file path: ${asset.path}`);
    }
    return rel;
  };
  const assets = [
    pack.pmtiles,
    pack.style,
    ...(pack.styleDark ? [pack.styleDark] : []),
    ...pack.assets,
  ];
  const files = assets.map((asset) => ({
    areaId,
    lang: SHARED,
    kind: 'map' as const,
    name: `${folder}/${relative(asset)}`,
    url: asset.url,
    sha256: asset.sha256,
    bytes: asset.bytes,
    placeId: null,
    verified: false,
  }));
  const prefixUrl = pack.pmtiles.url.slice(
    0,
    pack.pmtiles.url.length - relative(pack.pmtiles).length,
  );
  return {
    files,
    map: {
      version: pack.version,
      prefixUrl,
      folder,
      style: `${folder}/${relative(pack.style)}`,
      styleDark: pack.styleDark ? `${folder}/${relative(pack.styleDark)}` : null,
    },
  };
}

/**
 * Every file a manifest names, as rows: the map's under its relative paths, the snapshot, then the
 * photos and the audio **named by their `sha256`**, so no server path reaches the disk and a photo
 * shared by two Places, or two languages, is one file.
 */
export function filesOf(
  manifest: Pick<OfflineManifest, 'areaId' | 'lang' | 'mapPack' | 'places' | 'photos' | 'audio'>,
): { files: PackFile[]; map: PackMap | null } {
  const { areaId, lang } = manifest;
  const map = manifest.mapPack === null ? null : mapFiles(areaId, manifest.mapPack);
  const row = (
    kind: FileKind,
    fileLang: string,
    name: string,
    asset: OfflineAsset,
    placeId: string | null = null,
  ): PackFile => ({
    areaId,
    lang: fileLang,
    kind,
    name,
    url: asset.url,
    sha256: asset.sha256,
    bytes: asset.bytes,
    placeId,
    verified: false,
  });
  const files = [
    ...(map?.files ?? []),
    row('places', lang, `${lang}/places-${manifest.places.sha256}.ndjson.gz`, manifest.places),
    ...manifest.photos.map((photo) =>
      row('photo', SHARED, `photos/${photo.sha256}${extensionOf(photo.url)}`, photo),
    ),
    ...manifest.audio.map((audio) =>
      row(
        'audio',
        lang,
        `${lang}/audio/${audio.sha256}${extensionOf(audio.url)}`,
        audio,
        audio.placeId,
      ),
    ),
  ];
  // The same photo listed twice (two Places with one card) is one file.
  const seen = new Set<string>();
  return {
    files: files.filter((file) => {
      const key = `${file.lang}|${file.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    map: map?.map ?? null,
  };
}

/** The order a download takes: the product's (map, places, photos, audio). */
export function inOrder<T extends { readonly kind: FileKind }>(files: readonly T[]): T[] {
  return [...files].sort((a, b) => FILE_KINDS.indexOf(a.kind) - FILE_KINDS.indexOf(b.kind));
}

/**
 * What removing one language's pack deletes: its own files, and the files every language of the
 * area shares (the map, the photos) only when no other pack of the area remains (K10, K17).
 */
export function filesToRemove<T extends { readonly lang: string }>(
  files: readonly T[],
  otherPacksOfArea: number,
): T[] {
  return files.filter((file) => file.lang !== SHARED || otherPacksOfArea === 0);
}
