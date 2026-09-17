import { datasetVersionFromWire } from '@wayfare/contracts';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { toGeoPoint } from '../catalog/catalog.mapper';
import { areaResponseSchema } from './dto/area-response.dto';
import type { AreaResponseDto } from './dto/area-response.dto';

/** An area; its boundary travels as GeoJSON text and is served as an object. */
export function toAreaResponseDto(area: catalogGrpc.Area): AreaResponseDto {
  return {
    id: area.id,
    code: area.code,
    center: toGeoPoint(area.center),
    defaultZoom: area.defaultZoom,
    boundary: areaResponseSchema.shape.boundary.parse(JSON.parse(area.boundaryGeojson)),
    mapPack: null,
    datasetVersion: datasetVersionFromWire(area.datasetVersion),
  };
}
