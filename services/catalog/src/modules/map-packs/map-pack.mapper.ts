import { MapPackStatus, parseEnum } from '@wayfare/contracts';
import type { MapPackObject } from '@wayfare/contracts';
import { mapPackStatusProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import type { MapPack } from '../../../generated/prisma/client';
import { objectsOf, packBytes } from './domain/map-pack-objects';

/** A map pack's row. */
export type MapPackRow = MapPack;

/** One object on the wire: its size as an `int64` string. */
export function toMapPackObject(object: MapPackObject): catalogGrpc.MapPackObject {
  return { path: object.path, sha256: object.sha256, bytes: String(object.bytes) };
}

/** A map pack as the console lists it. */
export function toMapPack(row: MapPackRow): catalogGrpc.MapPack {
  const objects = objectsOf(row);
  const [pmtiles, style, ...files] = objects;
  return {
    id: row.id,
    areaId: row.areaId,
    version: row.version,
    status: mapPackStatusProto.toProto(parseEnum(MapPackStatus, row.status)),
    pmtiles: toMapPackObject(pmtiles!),
    style: toMapPackObject(style!),
    assets: files.map(toMapPackObject),
    totalBytes: String(packBytes(objects)),
    source: row.source,
    sourceDate: row.sourceDate.toISOString().slice(0, 10),
    minZoom: row.minZoom,
    maxZoom: row.maxZoom,
    buildTool: row.buildTool,
    publishedAt: row.publishedAt === null ? undefined : toProtoTimestamp(row.publishedAt),
    retiredAt: row.retiredAt === null ? undefined : toProtoTimestamp(row.retiredAt),
    createdAt: toProtoTimestamp(row.createdAt),
  };
}
