import type { MapPackStatus, MapPack, MapPackObject } from '@wayfare/contracts';
import { mapPackStatusProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { fromOptionalProtoTimestamp, fromProtoTimestamp } from '@wayfare/nest-common';
import type { RegisterMapPackDto } from './dto/admin-map-pack.dto';

/** One pack object; its size arrives as an `int64` string. */
export function toMapPackObject(object: catalogGrpc.MapPackObject | undefined): MapPackObject {
  if (object === undefined) throw new Error('catalog sent a map pack without an object');
  return { path: object.path, sha256: object.sha256, bytes: Number(object.bytes) };
}

/** A pack's status; an unknown value is a catalog newer than this gateway. */
function statusOf(value: number): MapPackStatus {
  const status = mapPackStatusProto.fromProto(value);
  if (status === null) throw new Error(`catalog sent an unknown map pack status: ${value}`);
  return status;
}

/** A map pack as the console lists it. */
export function toMapPack(pack: catalogGrpc.MapPack | undefined): MapPack {
  if (pack === undefined) throw new Error('catalog sent no map pack');
  return {
    id: pack.id,
    areaId: pack.areaId,
    version: pack.version,
    status: statusOf(pack.status),
    pmtiles: toMapPackObject(pack.pmtiles),
    style: toMapPackObject(pack.style),
    styleDark: pack.styleDark === undefined ? null : toMapPackObject(pack.styleDark),
    assets: pack.assets.map(toMapPackObject),
    totalBytes: Number(pack.totalBytes),
    source: pack.source,
    sourceDate: pack.sourceDate,
    minZoom: pack.minZoom,
    maxZoom: pack.maxZoom,
    buildTool: pack.buildTool,
    publishedAt: fromOptionalProtoTimestamp(pack.publishedAt, 'publishedAt')?.toISOString() ?? null,
    retiredAt: fromOptionalProtoTimestamp(pack.retiredAt, 'retiredAt')?.toISOString() ?? null,
    createdAt: fromProtoTimestamp(pack.createdAt, 'createdAt').toISOString(),
  };
}

/** The `RegisterMapPack` request; sizes travel as `int64` strings. */
export function toRegisterMapPackRequest(
  body: RegisterMapPackDto,
): catalogGrpc.RegisterMapPackRequest {
  const object = (item: MapPackObject): catalogGrpc.MapPackObject => ({
    path: item.path,
    sha256: item.sha256,
    bytes: String(item.bytes),
  });
  return {
    areaId: body.areaId,
    pmtiles: object(body.pmtiles),
    style: object(body.style),
    ...(body.styleDark === undefined ? {} : { styleDark: object(body.styleDark) }),
    assets: body.assets.map(object),
    source: body.source,
    sourceDate: body.sourceDate,
    minZoom: body.minZoom,
    maxZoom: body.maxZoom,
    buildTool: body.buildTool,
  };
}
