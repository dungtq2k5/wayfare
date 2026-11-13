import type { AdminCategory } from '@wayfare/contracts';
import { categoryAppliesToProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import type { CreateCategoryDto, UpdateCategoryDto } from './dto/admin-category.dto';

/** A category as the console lists it. */
export function toAdminCategory(category: catalogGrpc.AdminCategory | undefined): AdminCategory {
  if (category === undefined) throw new Error('catalog sent no category');
  const appliesTo = categoryAppliesToProto.fromProto(category.appliesTo);
  if (appliesTo === null) throw new Error(`catalog sent an unknown appliesTo for ${category.code}`);
  return {
    id: category.id,
    code: category.code,
    appliesTo,
    icon: category.icon,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    placeCount: category.placeCount,
  };
}

/** The `CreateCategory` request. */
export function toCreateCategoryRequest(
  body: CreateCategoryDto,
): catalogGrpc.CreateCategoryRequest {
  return {
    code: body.code,
    appliesTo: categoryAppliesToProto.toProto(body.appliesTo),
    icon: body.icon,
    sortOrder: body.sortOrder,
  };
}

/** The `UpdateCategory` request: only what the body carries. */
export function toUpdateCategoryRequest(
  categoryId: string,
  body: UpdateCategoryDto,
): catalogGrpc.UpdateCategoryRequest {
  return {
    categoryId,
    ...(body.appliesTo === undefined
      ? {}
      : { appliesTo: categoryAppliesToProto.toProto(body.appliesTo) }),
    ...(body.icon === undefined ? {} : { icon: body.icon }),
    ...(body.sortOrder === undefined ? {} : { sortOrder: body.sortOrder }),
    ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
  };
}
