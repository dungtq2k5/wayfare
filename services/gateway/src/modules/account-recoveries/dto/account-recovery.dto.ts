import { zCancelRecoveryInput, zCompleteRecoveryInput, zUuidV7 } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `/account-recoveries/:id/cancel`. */
export const accountRecoveryIdParamSchema = z.object({ id: zUuidV7 }).strict();

/** Validated case path parameter. */
export class AccountRecoveryIdParamDto extends createZodDto(accountRecoveryIdParamSchema) {}

/** Validated cancel body: the token from a hold notice, or nothing when the owner is signed in. */
export class CancelRecoveryDto extends createZodDto(zCancelRecoveryInput) {}

/** Validated completion body: the link's token and the new password, together. */
export class CompleteRecoveryDto extends createZodDto(zCompleteRecoveryInput) {}
