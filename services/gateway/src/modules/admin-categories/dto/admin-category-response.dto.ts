import { zAdminCategory } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** A category, active or not, with its Place count. */
export class AdminCategoryResponseDto extends createZodDto(zAdminCategory) {}

/** `{ category }`, as the category writes return it. */
export const adminCategoryResultResponseSchema = z.object({ category: zAdminCategory }).strict();

/** What the category writes return under `data`. */
export class AdminCategoryResultResponseDto extends createZodDto(
  adminCategoryResultResponseSchema,
) {}
