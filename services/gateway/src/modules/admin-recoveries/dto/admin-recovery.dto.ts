import {
  zOpenRecoveryInput,
  zRecoveryQuery,
  zRejectRecoveryInput,
  zUuidV7,
} from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `POST /admin/users/:id/email-recoveries`. */
export const recoverySubjectParamSchema = z.object({ id: zUuidV7 }).strict();

/** Validated subject path parameter. */
export class RecoverySubjectParamDto extends createZodDto(recoverySubjectParamSchema) {}

/** `/admin/email-recoveries/:id/…`. */
export const recoveryIdParamSchema = z.object({ id: zUuidV7 }).strict();

/** Validated case path parameter. */
export class RecoveryIdParamDto extends createZodDto(recoveryIdParamSchema) {}

/** Validated `POST /admin/users/:id/email-recoveries` body (api-endpoints-plan §1.10). */
export class OpenRecoveryDto extends createZodDto(zOpenRecoveryInput) {}

/** `GET /admin/email-recoveries` query. */
export class RecoveryQueryDto extends createZodDto(zRecoveryQuery) {}

/** Validated `POST /admin/email-recoveries/:id/reject` body. */
export class RejectRecoveryDto extends createZodDto(zRejectRecoveryInput) {}
