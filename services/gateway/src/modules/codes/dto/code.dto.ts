import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/** `/codes/:publicCode`: any printed form — dashes, case and Crockford's look-alikes are canonicalized. */
export const codeParamSchema = z.object({ publicCode: z.string().min(1).max(64) }).strict();

/** Validated code parameter. */
export class CodeParamDto extends createZodDto(codeParamSchema) {}
