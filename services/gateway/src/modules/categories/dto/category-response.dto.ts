import { CategoryAppliesTo, zUuidV7 } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** An active category (rdm-spec C-2). Its name comes from the UI bundle, `category.<code>`. */
export const categoryResponseSchema = z.object({
  id: zUuidV7,
  code: z.string(),
  appliesTo: z.enum(CategoryAppliesTo),
  icon: z.string(),
  sortOrder: z.number().int(),
});

/** One category, as `GET /categories` lists it. */
export class CategoryResponseDto extends createZodDto(categoryResponseSchema) {}
