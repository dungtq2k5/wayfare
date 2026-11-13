import { zUuidV7 } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** An owner Venue's `:id`. */
export const ownerPlaceIdParamSchema = z.object({ id: zUuidV7 }).strict();

/** Validated `:id`. */
export class OwnerPlaceIdParamDto extends createZodDto(ownerPlaceIdParamSchema) {}
