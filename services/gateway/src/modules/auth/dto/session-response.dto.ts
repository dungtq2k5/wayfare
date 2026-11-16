import { GoogleOutcome } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { userResponseSchema } from '../../users/dto/user-response.dto';

/**
 * A sign-in response (api-endpoints-plan §0.3). `console` and `web` receive `{ user }` and the
 * session cookies; only `mobile` receives the tokens in the body.
 */
export const sessionResponseSchema = z.object({
  user: userResponseSchema,
  /** `mobile` only. */
  accessToken: z.string().optional(),
  /** `mobile` only. */
  refreshToken: z.string().optional(),
  /** `mobile` only: seconds until the access token expires. */
  expiresIn: z.number().int().min(0).optional(),
});

/** What register, login and refresh return under `data`. */
export class SessionResponseDto extends createZodDto(sessionResponseSchema) {}

/** `POST /auth/google`: a session, and what the sign-in did (api-endpoints-plan §1.2). */
export const googleSessionResponseSchema = sessionResponseSchema.extend({
  outcome: z.enum(GoogleOutcome),
});

/** What `POST /auth/google` returns under `data`. */
export class GoogleSessionResponseDto extends createZodDto(googleSessionResponseSchema) {}

/** `POST /auth/google/nonce`: the value the next ID token must carry, for five minutes. */
export const googleNonceResponseSchema = z.object({ nonce: z.string() });

/** What `POST /auth/google/nonce` returns under `data`. */
export class GoogleNonceResponseDto extends createZodDto(googleNonceResponseSchema) {}

/** `POST /auth/google/confirm`: the proof that stands in for the current password, for five minutes. */
export const googleConfirmResponseSchema = z.object({ confirmation: z.string() });

/** What `POST /auth/google/confirm` returns under `data`. */
export class GoogleConfirmResponseDto extends createZodDto(googleConfirmResponseSchema) {}
