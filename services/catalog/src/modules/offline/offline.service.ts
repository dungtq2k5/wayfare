import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditResourceType,
  datasetVersionFromWire,
  MapPackStatus,
  PlaceStatus,
  zOfflineManifest,
  zOfflineManifestDiff,
  zPlaceSyncRecord,
  zRequestedLanguage,
  zUuidV7,
} from '@wayfare/contracts';
import type {
  OfflineAsset,
  OfflineManifest,
  OfflineManifestDiff,
  PlaceSyncRecord,
  RequestedLanguage,
} from '@wayfare/contracts';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { parseRpcRequest, requireDeviceContext, rpcError } from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { STORAGE_PROVIDER } from '@wayfare/nest-common/storage';
import type { StorageProvider } from '@wayfare/nest-common/storage';
import { Counter } from 'prom-client';
import { z } from 'zod';
import type { Env } from '../../config/env.schema';
import { objectsOf, partsOf } from '../map-packs/domain/map-pack-objects';
import { PlaceQueriesService } from '../place-queries/place-queries.service';
import { PrismaService } from '../prisma/prisma.service';
import { SyncService } from '../sync/sync.service';
import { mapPackFiles, mediaOf, offlineMapPack, snapshotPath, totalBytes } from './domain/manifest';
import { toOfflineAsset, toPlaceSyncRecord } from './offline.mapper';

/** Injection token for the manifest cache. */
export const MANIFEST_CACHE = Symbol('MANIFEST_CACHE');

/** The part of Redis the manifest cache uses. */
export interface ManifestCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
}

/** How long a computed manifest is served from the cache (api-endpoints-plan §2.4). */
export const MANIFEST_CACHE_SECONDS = 3600;

/** How long generating a snapshot may hold its lock: it reads, gzips and uploads one file. */
const SNAPSHOT_TIMEOUT_MS = 30_000;

const manifestCacheTotal = new Counter({
  name: 'offline_manifest_cache_total',
  help: 'Offline manifest requests answered from the cache (hit) or computed (miss).',
  labelNames: ['result'] as const,
});

const zVersion = z.string().transform((value, ctx) => {
  try {
    return BigInt(datasetVersionFromWire(value === '' ? '0' : value));
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Expected a non-negative safe integer' });
    return z.NEVER;
  }
});
const manifestFields = z.object({ areaId: zUuidV7, lang: zRequestedLanguage });
const diffFields = manifestFields.extend({
  fromDatasetVersion: zVersion,
  fromMapPackVersion: z.number().int().min(0),
});

/** A snapshot as the manifest names it, with the records it holds. */
interface Snapshot {
  readonly asset: OfflineAsset;
  readonly records: readonly PlaceSyncRecord[];
}

/** An area a device may take offline. */
interface OfflineArea {
  readonly id: string;
  readonly code: string;
}

/**
 * The offline pack (api-endpoints-plan §2.4, rdm-spec C-14): the published map pack, a places
 * snapshot at delta sync's cap, and the media its records name — every asset with its `sha256`.
 * The diff is delta sync plus the same assets; a device never needs a second notion of "current".
 */
@Injectable()
export class OfflineService {
  private readonly mediaBase: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
    private readonly queries: PlaceQueriesService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(MANIFEST_CACHE) private readonly cache: ManifestCache,
    config: ConfigService<Env, true>,
  ) {
    this.mediaBase = config.get('GCS_PUBLIC_BASE_URL', { infer: true });
  }

  async getManifest(
    request: catalogGrpc.GetManifestRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.GetManifestResponse> {
    requireDeviceContext(context);
    const fields = parseRpcRequest(manifestFields, request);
    const area = await this.offlineArea(fields.areaId);
    const [cap, pack] = await Promise.all([this.sync.cap(), this.publishedPack(area.id)]);
    const lang = langKey(fields.lang);
    const key = `offline:manifest:${area.id}:${lang}:${cap}:${pack?.version ?? 0}`;
    const cached = await this.cache.get(key).catch(() => null);
    if (cached !== null) {
      manifestCacheTotal.inc({ result: 'hit' });
      return { manifestJson: cached };
    }
    manifestCacheTotal.inc({ result: 'miss' });

    const snapshot = await this.snapshot(area, fields.lang, cap);
    const media = mediaOf(snapshot.records, (object) => toOfflineAsset(object, this.mediaBase));
    const mapPack = pack === null ? null : offlineMapPack(pack.version, pack.parts, this.mediaBase);
    const manifest: OfflineManifest = zOfflineManifest.parse({
      areaId: area.id,
      lang,
      datasetVersion: Number(cap),
      mapPack,
      places: snapshot.asset,
      photos: media.photos,
      audio: media.audio,
      totalBytes: totalBytes([
        [snapshot.asset],
        media.photos,
        media.audio,
        mapPack === null ? [] : mapPackFiles(mapPack),
      ]),
    });
    const json = JSON.stringify(manifest);
    await this.cache.set(key, json, 'EX', MANIFEST_CACHE_SECONDS).catch(() => undefined);
    return { manifestJson: json };
  }

  async getManifestDiff(
    request: catalogGrpc.GetManifestDiffRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.GetManifestDiffResponse> {
    requireDeviceContext(context);
    const fields = parseRpcRequest(diffFields, request);
    const area = await this.offlineArea(fields.areaId);
    const current = await this.publishedPack(area.id);

    // The map pack: unchanged, replaced (its old objects to drop), or gone with its objects.
    let mapPack = null;
    let drop: string[] = [];
    if (fields.fromMapPackVersion !== (current?.version ?? 0)) {
      if (fields.fromMapPackVersion > 0) {
        const old = await this.prisma.mapPack.findUnique({
          where: {
            areaId_version: { areaId: area.id, version: fields.fromMapPackVersion },
          },
        });
        if (old === null || old.objectsDeletedAt !== null) throw rpcError('DIFF_UNAVAILABLE');
        drop = objectsOf(old).map((object) => object.path);
      }
      mapPack =
        current === null ? null : offlineMapPack(current.version, current.parts, this.mediaBase);
    }

    // The Places: delta sync's own pages, up to one cap.
    const changed: string[] = [];
    const removed: string[] = [];
    let since = fields.fromDatasetVersion;
    const cap = await this.sync.cap();
    if (since > cap) {
      throw rpcError('VALIDATION_FAILED', {
        issues: [{ path: '/fromDatasetVersion', code: 'ahead_of_current' }],
      });
    }
    for (;;) {
      const page = await this.sync.changes({ areaId: area.id, since });
      for (const change of page.changes) {
        if (change.syncVersion > cap) continue;
        if (change.live) changed.push(change.id);
        else if (fields.fromDatasetVersion > 0n) removed.push(change.id);
      }
      if (page.complete || page.datasetVersion >= cap) break;
      since = page.datasetVersion;
    }
    const records = await this.records(changed, fields.lang);
    const media = mediaOf(records, (object) => toOfflineAsset(object, this.mediaBase));
    const snapshot = await this.snapshot(area, fields.lang, cap);
    const diff: OfflineManifestDiff = zOfflineManifestDiff.parse({
      areaId: area.id,
      lang: langKey(fields.lang),
      fromDatasetVersion: Number(fields.fromDatasetVersion),
      datasetVersion: Number(cap),
      changedPlaceIds: changed,
      removedPlaceIds: removed,
      places: snapshot.asset,
      photos: media.photos,
      audio: media.audio,
      mapPack,
      drop,
      totalBytes: totalBytes([
        [snapshot.asset],
        media.photos,
        media.audio,
        mapPack === null ? [] : mapPackFiles(mapPack),
      ]),
    });
    return { diffJson: JSON.stringify(diff) };
  }

  /** An active area; an inactive or unknown one is `404`, as for `/sync/places`. */
  private async offlineArea(areaId: string): Promise<OfflineArea> {
    const area = await this.prisma.area.findUnique({
      where: { id: areaId },
      select: { id: true, code: true, isActive: true },
    });
    if (area === null || !area.isActive) {
      throw rpcError('RESOURCE_NOT_FOUND', { resource: AuditResourceType.AREA });
    }
    return area;
  }

  private async publishedPack(areaId: string) {
    const pack = await this.prisma.mapPack.findFirst({
      where: { areaId, status: MapPackStatus.PUBLISHED },
    });
    return pack === null ? null : { version: pack.version, parts: partsOf(pack) };
  }

  private async records(
    ids: readonly string[],
    lang: RequestedLanguage,
  ): Promise<PlaceSyncRecord[]> {
    const records = await this.queries.syncRecords(ids, lang.lang);
    return ids.flatMap((id) => {
      const record = records.get(id);
      return record === undefined ? [] : [toPlaceSyncRecord(record)];
    });
  }

  /**
   * The area's live Places with `sync_version ≤ cap` (api-endpoints-plan §2.4), as gzipped
   * NDJSON. Named by the area's own last change and its live count, so a change elsewhere reuses
   * the file; generated once under a lock on its path, never rewritten.
   */
  private async snapshot(
    area: OfflineArea,
    lang: RequestedLanguage,
    cap: bigint,
  ): Promise<Snapshot> {
    const live: string = PlaceStatus.ACTIVE;
    const [rows, [latest]] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM places
        WHERE area_id = ${area.id}::uuid AND status = ${live} AND deleted_at IS NULL
          AND sync_version <= ${cap}::bigint
        ORDER BY sync_version`,
      this.prisma.$queryRaw<{ version: bigint }[]>`
        SELECT COALESCE(MAX(sync_version), 0) AS version FROM places
        WHERE area_id = ${area.id}::uuid AND sync_version <= ${cap}::bigint`,
    ]);
    const path = snapshotPath(area.code, langKey(lang), latest!.version, rows.length);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`catalog:snapshot:${path}`}))`;
        let data: Buffer;
        let records: PlaceSyncRecord[];
        if ((await this.storage.stat(path)) !== null) {
          data = await this.storage.download(path);
          records = gunzipSync(data)
            .toString('utf8')
            .split('\n')
            .filter((line) => line !== '')
            .map((line) => zPlaceSyncRecord.parse(JSON.parse(line)));
        } else {
          records = await this.records(
            rows.map((row) => row.id),
            lang,
          );
          const ndjson = records.map((record) => `${JSON.stringify(record)}\n`).join('');
          data = gzipSync(Buffer.from(ndjson, 'utf8'));
          await this.storage.upload(path, data, {
            contentType: 'application/x-ndjson',
            cacheControl: 'public, max-age=31536000, immutable',
          });
        }
        return {
          asset: {
            path,
            url: `${this.mediaBase}/${path}`,
            sha256: createHash('sha256').update(data).digest('hex'),
            bytes: data.length,
          },
          records,
        };
      },
      { timeout: SNAPSHOT_TIMEOUT_MS },
    );
  }
}

/** The language a pack is cached and stored under: the served one, or `und` for the fallback. */
function langKey(lang: RequestedLanguage): string {
  return lang.lang ?? 'und';
}
