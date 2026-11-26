import { CategoryAppliesTo } from '@wayfare/contracts';
import { categoryAppliesToProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { describe, expect, it } from 'vitest';
import { toAdminCategory, toUpdateCategoryRequest } from './admin-category.mapper';

describe('a category', () => {
  const category = {
    id: 'c1',
    code: 'TEMPLE',
    appliesTo: categoryAppliesToProto.toProto(CategoryAppliesTo.EDITORIAL),
    icon: 'temple',
    sortOrder: 1,
    isActive: true,
    placeCount: 4,
  } as catalogGrpc.AdminCategory;

  it('reads what it applies to, and refuses a value this build doesn’t know or no category', () => {
    expect(toAdminCategory(category).appliesTo).toBe(CategoryAppliesTo.EDITORIAL);
    expect(() => toAdminCategory({ ...category, appliesTo: 99 as never })).toThrow(
      'catalog sent an unknown appliesTo for TEMPLE',
    );
    expect(() => toAdminCategory(undefined)).toThrow('catalog sent no category');
  });

  it('updates only what the body carries', () => {
    expect(toUpdateCategoryRequest('c1', {})).toEqual({ categoryId: 'c1' });
    expect(
      toUpdateCategoryRequest('c1', {
        appliesTo: CategoryAppliesTo.ANY,
        icon: 'x',
        sortOrder: 2,
        isActive: false,
      }),
    ).toEqual({
      categoryId: 'c1',
      appliesTo: categoryAppliesToProto.toProto(CategoryAppliesTo.ANY),
      icon: 'x',
      sortOrder: 2,
      isActive: false,
    });
  });
});
