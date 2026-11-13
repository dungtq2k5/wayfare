import { zRecovery } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** One recovery case, as staff read it. */
export class RecoveryResponseDto extends createZodDto(zRecovery) {}

/** `{ recovery }`, as opening and deciding return it. */
export const recoveryResultResponseSchema = z.object({ recovery: zRecovery }).strict();

/** What the write routes answer under `data`. */
export class RecoveryResultResponseDto extends createZodDto(recoveryResultResponseSchema) {}
