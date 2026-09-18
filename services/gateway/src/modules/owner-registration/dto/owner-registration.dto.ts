import { zOwnerRegistrationInput, zUuidV7 } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Validated `POST /owner/registration` body (api-endpoints-plan §1.4). */
export class SubmitRegistrationDto extends createZodDto(zOwnerRegistrationInput) {}

/** `/owner/registration/:id`. */
export const registrationIdParamSchema = z.object({ id: zUuidV7 }).strict();

/** Validated registration path parameter. */
export class RegistrationIdParamDto extends createZodDto(registrationIdParamSchema) {}
