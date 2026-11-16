import { zCategoryCreateInput, zCategoryUpdateInput, zUuidV7 } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `/admin/categories/:id`. */
export const categoryIdParamSchema = z.object({ id: zUuidV7 }).strict();

/** Validated category path parameter. */
export class CategoryIdParamDto extends createZodDto(categoryIdParamSchema) {}

/** Validated `POST /admin/categories` body (api-endpoints-plan §3.6). */
export class CreateCategoryDto extends createZodDto(zCategoryCreateInput) {}

/** Validated `PATCH /admin/categories/:id` body: never the code. */
export class UpdateCategoryDto extends createZodDto(zCategoryUpdateInput) {}
