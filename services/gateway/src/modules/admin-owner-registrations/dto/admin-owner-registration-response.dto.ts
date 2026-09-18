import {
  zOwnerRegistrationAdmin,
  zOwnerRegistrationAdminItem,
  zRevealedNationalId,
} from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** A queue row. */
export class OwnerRegistrationAdminItemResponseDto extends createZodDto(
  zOwnerRegistrationAdminItem,
) {}

/** The review detail: the national ID as its last four only. */
export class OwnerRegistrationAdminResponseDto extends createZodDto(zOwnerRegistrationAdmin) {}

/** `{ registration }`, as approving and rejecting return it. */
export const ownerRegistrationAdminResultResponseSchema = z
  .object({ registration: zOwnerRegistrationAdmin })
  .strict();

/** What `POST …/approve` and `…/reject` return under `data`. */
export class OwnerRegistrationAdminResultResponseDto extends createZodDto(
  ownerRegistrationAdminResultResponseSchema,
) {}

/** `{ nationalId }`, served once with `no-store`. */
export class RevealedNationalIdResponseDto extends createZodDto(zRevealedNationalId) {}
