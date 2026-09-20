import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  MAX_MAP_PACK_BYTES,
  MapPackStatus,
  mapPackBuildId,
  mapPackPrefix,
  newId,
  zRegisterMapPackInput,
  zUuidV7,
} from '@wayfare/contracts';
import type { MapPackObject, RegisterMapPackInput } from '@wayfare/contracts';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import {
  OutboxService,
  parseRpcRequest,
  requireAccountContext,
  rpcError,
} from '@wayfare/nest-common';
import type { AccountContext, RequestContext } from '@wayfare/nest-common';
import { STORAGE_PROVIDER } from '@wayfare/nest-common/storage';
import type { StorageProvider } from '@wayfare/nest-common/storage';
import { z } from 'zod';
import { taxonomyAuditRecord } from '../places/domain/place-audit';
import { PrismaService } from '../prisma/prisma.service';
import type { CatalogTx } from '../sync/sync.service';
import type { MapPackAssets } from './domain/map-pack-objects';
import { packBytes } from './domain/map-pack-objects';
import { toMapPack } from './map-pack.mapper';

const listFields = z.object({ areaId: zUuidV7.optional() });
const packIdField = z.object({ mapPackId: zUuidV7 });

/** How many objects are re-hashed at once. */
const REHASH_CONCURRENCY = 4;

/** An object's SHA-256 and length, read as a stream. */
async function hashOf(storage: StorageProvider, path: string): Promise<MapPackObject> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of storage.read(path)) {
    const buffer = chunk as Buffer;
    hash.update(buffer);
    bytes += buffer.length;
  }
  return { path, sha256: hash.digest('hex'), bytes };
}

/**
 * The map packs (rdm-spec C-14, api-endpoints-plan §3.6). A registration is trusted for nothing:
 * every object must lie under its build's prefix and is re-hashed from the bucket; the version is
 * the server's. Publishing retires the area's previous pack in the same transaction.
 */
@Injectable()
export class MapPacksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async listMapPacks(
    request: catalogGrpc.ListMapPacksRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.ListMapPacksResponse> {
    requireAccountContext(context);
    const { areaId } = parseRpcRequest(listFields, { areaId: request.areaId ?? undefined });
    const rows = await this.prisma.mapPack.findMany({
      where: areaId === undefined ? {} : { areaId },
      orderBy: [{ areaId: 'asc' }, { version: 'desc' }],
    });
    return { mapPacks: rows.map(toMapPack) };
  }

  async registerMapPack(
    request: catalogGrpc.RegisterMapPackRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.RegisterMapPackResponse> {
    const actor = requireAccountContext(context);
    const object = (value: catalogGrpc.MapPackObject | undefined) =>
      value === undefined ? undefined : { ...value, bytes: Number(value.bytes) };
    const input = parseRpcRequest(zRegisterMapPackInput, {
      areaId: request.areaId,
      pmtiles: object(request.pmtiles),
      style: object(request.style),
      assets: request.assets.map(object),
      source: request.source,
      sourceDate: request.sourceDate,
      minZoom: request.minZoom,
      maxZoom: request.maxZoom,
      buildTool: request.buildTool,
    });
    const area = await this.prisma.area.findUnique({
      where: { id: input.areaId },
      select: { code: true },
    });
    if (area === null) throw rpcError('RESOURCE_NOT_FOUND', { resource: AuditResourceType.AREA });

    const prefix = mapPackPrefix(area.code, mapPackBuildId(input.pmtiles.sha256));
    const claimed: [string, MapPackObject][] = [
      ['/pmtiles/path', input.pmtiles],
      ['/style/path', input.style],
      ...input.assets.map((asset, index): [string, MapPackObject] => [
        `/assets/${index}/path`,
        asset,
      ]),
    ];
    const outside = claimed.filter(([, item]) => !item.path.startsWith(prefix));
    if (outside.length > 0) {
      throw rpcError('VALIDATION_FAILED', {
        issues: outside.map(([path]) => ({ path, code: 'outside_build_prefix' })),
      });
    }
    const claimedBytes = packBytes(claimed.map(([, item]) => item));
    if (claimedBytes > MAX_MAP_PACK_BYTES) {
      throw rpcError('MAP_PACK_TOO_LARGE', { bytes: claimedBytes, maxBytes: MAX_MAP_PACK_BYTES });
    }
    await this.rehash(claimed.map(([, item]) => item));

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`catalog:map-packs:${input.areaId}`}))`;
      const latest = await tx.mapPack.aggregate({
        where: { areaId: input.areaId },
        _max: { version: true },
      });
      const version = (latest._max.version ?? 0) + 1;
      const created = await tx.mapPack.create({
        data: this.columns(input, version, actor.userId),
      });
      await this.audit(tx, actor, AuditAction.MAP_PACK_REGISTERED, created.id, {
        after: {
          areaId: input.areaId,
          version,
          pmtilesBytes: input.pmtiles.bytes,
          buildTool: input.buildTool,
        },
      });
      return created;
    });
    return { mapPack: toMapPack(row) };
  }

  async publishMapPack(
    request: catalogGrpc.PublishMapPackRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.PublishMapPackResponse> {
    const actor = requireAccountContext(context);
    const { mapPackId } = parseRpcRequest(packIdField, request);
    const row = await this.prisma.$transaction(async (tx) => {
      const [pack] = await tx.$queryRaw<{ area_id: string; status: string }[]>`
        SELECT area_id, status FROM map_packs WHERE id = ${mapPackId}::uuid FOR UPDATE`;
      if (pack === undefined) {
        throw rpcError('RESOURCE_NOT_FOUND', { resource: AuditResourceType.MAP_PACK });
      }
      if (pack.status === String(MapPackStatus.PUBLISHED)) {
        return tx.mapPack.findUniqueOrThrow({ where: { id: mapPackId } });
      }
      if (pack.status !== String(MapPackStatus.BUILDING)) {
        throw rpcError('INVALID_STATE', { status: pack.status });
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`catalog:map-packs:${pack.area_id}`}))`;
      const now = new Date();
      const previous = await tx.mapPack.findFirst({
        where: { areaId: pack.area_id, status: MapPackStatus.PUBLISHED },
        select: { id: true, version: true },
      });
      if (previous !== null) {
        await tx.mapPack.update({
          where: { id: previous.id },
          data: { status: MapPackStatus.RETIRED, retiredAt: now },
        });
      }
      const published = await tx.mapPack.update({
        where: { id: mapPackId },
        data: { status: MapPackStatus.PUBLISHED, publishedAt: now },
      });
      await this.audit(tx, actor, AuditAction.MAP_PACK_PUBLISHED, mapPackId, {
        before: { previousVersion: previous?.version ?? null },
        after: { version: published.version },
      });
      return published;
    });
    return { mapPack: toMapPack(row) };
  }

  /** Re-hashes every object from the bucket; the first missing or different one is refused. */
  private async rehash(objects: readonly MapPackObject[]): Promise<void> {
    const queue = [...objects];
    const worker = async (): Promise<void> => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        if ((await this.storage.stat(next.path)) === null) {
          throw rpcError('MAP_PACK_OBJECT_MISSING', { path: next.path });
        }
        const actual = await hashOf(this.storage, next.path);
        if (actual.sha256 !== next.sha256 || actual.bytes !== next.bytes) {
          throw rpcError('MAP_PACK_HASH_MISMATCH', { path: next.path });
        }
      }
    };
    await Promise.all(Array.from({ length: REHASH_CONCURRENCY }, worker));
  }

  private columns(input: RegisterMapPackInput, version: number, createdById: string) {
    const assets: MapPackAssets = { style: input.style, files: input.assets };
    return {
      id: newId(),
      areaId: input.areaId,
      version,
      status: MapPackStatus.BUILDING,
      pmtilesObjectPath: input.pmtiles.path,
      pmtilesSha256: input.pmtiles.sha256,
      pmtilesBytes: BigInt(input.pmtiles.bytes),
      styleObjectPath: input.style.path,
      assets: assets as unknown as object,
      source: input.source,
      sourceDate: new Date(`${input.sourceDate}T00:00:00.000Z`),
      minZoom: input.minZoom,
      maxZoom: input.maxZoom,
      buildTool: input.buildTool,
      createdById,
    };
  }

  private async audit(
    tx: CatalogTx,
    actor: AccountContext,
    action: AuditAction,
    mapPackId: string,
    metadata: { before?: Record<string, unknown>; after?: Record<string, unknown> },
  ): Promise<void> {
    await this.outbox.add(
      tx,
      AUDIT_RECORD,
      taxonomyAuditRecord({
        actor: { type: AuditActorType.USER, userId: actor.userId },
        action,
        resource: AuditResourceType.MAP_PACK,
        resourceId: mapPackId,
        metadata,
        origin: actor.origin,
        now: new Date(),
      }),
    );
  }
}
