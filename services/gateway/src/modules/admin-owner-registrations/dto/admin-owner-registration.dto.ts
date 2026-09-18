import {
  zApproveRegistrationInput,
  zOwnerRegistrationQueueQuery,
  zRejectRegistrationInput,
  zUuidV7,
} from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Validated `GET /admin/owner-registrations` query (api-endpoints-plan §1.5). */
export class OwnerRegistrationQueueQueryDto extends createZodDto(zOwnerRegistrationQueueQuery) {}

/** `/admin/owner-registrations/:id`. */
export const ownerRegistrationIdParamSchema = z.object({ id: zUuidV7 }).strict();

/** Validated registration path parameter. */
export class OwnerRegistrationIdParamDto extends createZodDto(ownerRegistrationIdParamSchema) {}

/** Validated `POST …/approve` body. */
export class ApproveRegistrationDto extends createZodDto(zApproveRegistrationInput) {}

/** Validated `POST …/reject` body: `decisionNote` is required. */
export class RejectRegistrationDto extends createZodDto(zRejectRegistrationInput) {}
