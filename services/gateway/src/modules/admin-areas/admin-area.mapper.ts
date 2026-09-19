import { zAdminArea } from '@wayfare/contracts';
import type { AdminArea } from '@wayfare/contracts';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { toGeoPoint } from '../catalog/catalog.mapper';
import type { CreateAreaDto, UpdateAreaDto } from './dto/admin-area.dto';

/** An area as the console shows it; its boundary travels as GeoJSON text. */
export function toAdminArea(area: catalogGrpc.AdminArea | undefined): AdminArea {
  if (area === undefined) throw new Error('catalog sent no area');
  const counts = area.placeCounts;
  return {
    id: area.id,
    code: area.code,
    nameVi: area.nameVi,
    boundary: zAdminArea.shape.boundary.parse(JSON.parse(area.boundaryGeojson)),
    center: toGeoPoint(area.center),
    defaultZoom: area.defaultZoom,
    sortOrder: area.sortOrder,
    isActive: area.isActive,
    placeCounts: {
      DRAFT: counts?.draft ?? 0,
      PROCESSING: counts?.processing ?? 0,
      ACTIVE: counts?.active ?? 0,
      INACTIVE: counts?.inactive ?? 0,
    },
  };
}

/** The `CreateArea` request. */
export function toCreateAreaRequest(body: CreateAreaDto): catalogGrpc.CreateAreaRequest {
  return {
    code: body.code,
    nameVi: body.nameVi,
    boundaryGeojson: JSON.stringify(body.boundary),
    center: body.center,
    defaultZoom: body.defaultZoom,
    sortOrder: body.sortOrder,
    isActive: body.isActive,
  };
}

/** The `UpdateArea` request: only what the body carries. */
export function toUpdateAreaRequest(
  areaId: string,
  body: UpdateAreaDto,
): catalogGrpc.UpdateAreaRequest {
  return {
    areaId,
    ...(body.nameVi === undefined ? {} : { nameVi: body.nameVi }),
    ...(body.boundary === undefined ? {} : { boundaryGeojson: JSON.stringify(body.boundary) }),
    center: body.center,
    ...(body.defaultZoom === undefined ? {} : { defaultZoom: body.defaultZoom }),
    ...(body.sortOrder === undefined ? {} : { sortOrder: body.sortOrder }),
    ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
  };
}
