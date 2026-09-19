import type { AdminArea, AdminCategory } from '@wayfare/contracts';
import { categoryAppliesToProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';

/** A category as the console lists it. */
export function toAdminCategory(category: AdminCategory): catalogGrpc.AdminCategory {
  return {
    id: category.id,
    code: category.code,
    appliesTo: categoryAppliesToProto.toProto(category.appliesTo),
    icon: category.icon,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    placeCount: category.placeCount,
  };
}

/** An area as the console shows it: the boundary as GeoJSON text. */
export function toAdminArea(area: AdminArea): catalogGrpc.AdminArea {
  return {
    id: area.id,
    code: area.code,
    nameVi: area.nameVi,
    boundaryGeojson: JSON.stringify(area.boundary),
    center: area.center,
    defaultZoom: area.defaultZoom,
    sortOrder: area.sortOrder,
    isActive: area.isActive,
    placeCounts: {
      draft: area.placeCounts.DRAFT,
      processing: area.placeCounts.PROCESSING,
      active: area.placeCounts.ACTIVE,
      inactive: area.placeCounts.INACTIVE,
    },
  };
}
