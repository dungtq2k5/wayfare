import { MAX_FULL_NAME_LENGTH, zEmail } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `POST /dev/google-token` body: who the fake Google account is, and the device's nonce. */
export const fakeGoogleTokenBodySchema = z
  .object({
    email: zEmail,
    name: z.string().min(1).max(MAX_FULL_NAME_LENGTH).optional(),
    sub: z.string().min(1).max(255).optional(),
    emailVerified: z.boolean().default(true),
    hd: z.string().min(1).max(253).optional(),
    nonce: z.string().min(1).max(256),
  })
  .strict();

/** Validated `POST /dev/google-token` body. */
export class FakeGoogleTokenDto extends createZodDto(fakeGoogleTokenBodySchema) {}
