import { ActionTokenPurpose } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `POST /auth/password/reset/validate` — what the page needs to choose its form. */
export const resetLinkResponseSchema = z.object({
  valid: z.literal(true),
  /** `ACCOUNT_SETUP` says "choose your password", `PASSWORD_RESET` "reset your password". */
  purpose: z.enum([ActionTokenPurpose.PASSWORD_RESET, ActionTokenPurpose.ACCOUNT_SETUP]),
  emailMasked: z.string(),
});

/** What `POST /auth/password/reset/validate` returns under `data`. */
export class ResetLinkResponseDto extends createZodDto(resetLinkResponseSchema) {}
