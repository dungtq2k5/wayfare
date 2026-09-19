import { zAdminArea } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** An area, active or not, with its Places by status. */
export class AdminAreaResponseDto extends createZodDto(zAdminArea) {}

/** `{ area }`, as the area reads and writes return it. */
export const adminAreaResultResponseSchema = z.object({ area: zAdminArea }).strict();

/** What the one-area read and the area writes return under `data`. */
export class AdminAreaResultResponseDto extends createZodDto(adminAreaResultResponseSchema) {}
