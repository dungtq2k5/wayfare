import { zOwnerRegistration } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** An application as its applicant sees it — no staff note, no national ID beyond its last four. */
export class OwnerRegistrationResponseDto extends createZodDto(zOwnerRegistration) {}

/** `{ registration }`, as applying and withdrawing return it. */
export const ownerRegistrationResultResponseSchema = z
  .object({ registration: zOwnerRegistration })
  .strict();

/** What `POST /owner/registration` and `…/withdraw` return under `data`. */
export class OwnerRegistrationResultResponseDto extends createZodDto(
  ownerRegistrationResultResponseSchema,
) {}
