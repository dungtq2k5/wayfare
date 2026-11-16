import { categoryAppliesToProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import type { CategoryResponseDto } from './dto/category-response.dto';

/** A category, field by field. */
export function toCategoryResponseDto(category: catalogGrpc.Category): CategoryResponseDto {
  const appliesTo = categoryAppliesToProto.fromProto(category.appliesTo);
  if (appliesTo === null)
    throw new Error(`catalog sent an unknown appliesTo: ${category.appliesTo}`);
  return {
    id: category.id,
    code: category.code,
    appliesTo,
    icon: category.icon,
    sortOrder: category.sortOrder,
  };
}
