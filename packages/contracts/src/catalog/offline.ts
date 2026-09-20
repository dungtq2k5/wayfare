import { z } from 'zod';
import { zUuidV7 } from '../common/ids';
import { zSha256Hex } from '../events/event-definition';
import { MapPackStatus } from './enums';
import { zDatasetVersion, zPlaceSummary } from './sync';

/** The most a map pack may weigh, the archive and its assets together (architecture §6). */
export const MAX_MAP_PACK_BYTES = 60_000_000;

/**
 * The glyph files a map pack carries per font stack (architecture §6): Latin, Latin Extended A
 * and B, Latin Extended Additional — without U+1E00–1EFF Vietnamese names lose letters — and
 * general punctuation. Each file holds 256 code points.
 */
export const MAP_PACK_GLYPH_RANGES = [
  '0-255',
  '256-511',
  '512-767',
  '7680-7935',
  '8192-8447',
] as const;

/** Where a pack's objects live in the media bucket (rdm-spec C-14): `maps/<areaCode>/<buildId>/`. */
export const mapPackPrefix = (areaCode: string, buildId: string) => `maps/${areaCode}/${buildId}/`;

/** A build's id: the first 16 hex characters of its archive's SHA-256 (rdm-spec C-14). */
export const mapPackBuildId = (pmtilesSha256: string) => pmtilesSha256.slice(0, 16);

/**
 * An object path in the media bucket: relative, with no empty, `.` or `..` segment. A space and
 * an `@` are allowed: glyph folders are named by their font stack (`fonts/Noto Sans Regular/…`)
 * and high-density sprites by their scale (`sprites/v4/light@2x.png`).
 */
const zObjectPath = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9._\-/ @]+$/)
  .refine((path) => path.split('/').every((part) => part !== '' && part !== '.' && part !== '..'), {
    message: 'Expected a relative path',
  });

/** One uploaded object of a map pack, as the build claims it; the server re-hashes it. */
export const zMapPackObject = z
  .object({ path: zObjectPath, sha256: zSha256Hex, bytes: z.number().int().min(1) })
  .strict();
/** One map pack object. */
export type MapPackObject = z.output<typeof zMapPackObject>;

/** `POST /admin/map-packs` body (api-endpoints-plan §3.6): every object with its hash. */
export const zRegisterMapPackInput = z
  .object({
    areaId: zUuidV7,
    pmtiles: zMapPackObject,
    style: zMapPackObject,
    assets: z.array(zMapPackObject).max(500),
    source: z.string().trim().min(1).max(64),
    sourceDate: z.iso.date(),
    minZoom: z.number().int().min(0).max(22),
    maxZoom: z.number().int().min(0).max(22),
    buildTool: z.string().trim().min(1).max(64),
  })
  .strict()
  .refine((input) => input.maxZoom >= input.minZoom, {
    path: ['maxZoom'],
    message: 'maxZoom is below minZoom',
  });
/** A validated registration. */
export type RegisterMapPackInput = z.output<typeof zRegisterMapPackInput>;

/** A map pack as the console lists it. */
export const zMapPack = z
  .object({
    id: zUuidV7,
    areaId: zUuidV7,
    version: z.number().int().min(1),
    status: z.enum(MapPackStatus),
    pmtiles: zMapPackObject,
    style: zMapPackObject,
    assets: z.array(zMapPackObject),
    totalBytes: z.number().int().min(0),
    source: z.string(),
    sourceDate: z.iso.date(),
    minZoom: z.number().int(),
    maxZoom: z.number().int(),
    buildTool: z.string(),
    publishedAt: z.iso.datetime({ offset: true }).nullable(),
    retiredAt: z.iso.datetime({ offset: true }).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();
/** A console map pack. */
export type MapPack = z.output<typeof zMapPack>;

/** One downloadable object of an offline pack: its bucket path, its public URL, and its check. */
export const zOfflineAsset = z
  .object({
    path: z.string().min(1),
    url: z.url(),
    sha256: zSha256Hex,
    bytes: z.number().int().min(1),
  })
  .strict();
/** One offline asset. */
export type OfflineAsset = z.output<typeof zOfflineAsset>;

/** A Place's narration in the pack's language. */
export const zOfflineAudio = zOfflineAsset.extend({ placeId: zUuidV7 }).strict();
/** One offline narration. */
export type OfflineAudio = z.output<typeof zOfflineAudio>;

/** The published map pack as a device downloads it. */
export const zOfflineMapPack = z
  .object({
    version: z.number().int().min(1),
    pmtiles: zOfflineAsset,
    style: zOfflineAsset,
    assets: z.array(zOfflineAsset),
  })
  .strict();
/** An offline map pack. */
export type OfflineMapPack = z.output<typeof zOfflineMapPack>;

/**
 * `GET /offline/areas/:areaId/manifest` (api-endpoints-plan §2.4): every asset with its `sha256`,
 * verified before activation. `datasetVersion` is delta sync's cap.
 */
export const zOfflineManifest = z
  .object({
    areaId: zUuidV7,
    lang: z.string().min(1),
    datasetVersion: zDatasetVersion,
    mapPack: zOfflineMapPack.nullable(),
    places: zOfflineAsset,
    photos: z.array(zOfflineAsset),
    audio: z.array(zOfflineAudio),
    totalBytes: z.number().int().min(0),
  })
  .strict();
/** An offline manifest. */
export type OfflineManifest = z.output<typeof zOfflineManifest>;

/**
 * `GET /offline/areas/:areaId/manifest/diff` (api-endpoints-plan §2.4): delta sync since
 * `fromDatasetVersion` with its assets, a new snapshot, and the map pack only when it changed.
 * `drop` names the paths of the replaced pack; a device drops what it holds for `removedPlaceIds`.
 */
export const zOfflineManifestDiff = z
  .object({
    areaId: zUuidV7,
    lang: z.string().min(1),
    fromDatasetVersion: zDatasetVersion,
    datasetVersion: zDatasetVersion,
    changedPlaceIds: z.array(zUuidV7),
    removedPlaceIds: z.array(zUuidV7),
    places: zOfflineAsset,
    photos: z.array(zOfflineAsset),
    audio: z.array(zOfflineAudio),
    mapPack: zOfflineMapPack.nullable(),
    drop: z.array(z.string().min(1)),
    totalBytes: z.number().int().min(0),
  })
  .strict();
/** An offline manifest diff. */
export type OfflineManifestDiff = z.output<typeof zOfflineManifestDiff>;

/** A saved Place, as the favourites list shows it (api-endpoints-plan §2.3). */
export const zFavorite = z
  .object({
    placeId: zUuidV7,
    savedAt: z.iso.datetime({ offset: true }),
    place: zPlaceSummary.omit({ distanceM: true, walkingEtaMinutes: true, sponsored: true }),
  })
  .strict();
/** A favourite. */
export type Favorite = z.output<typeof zFavorite>;
