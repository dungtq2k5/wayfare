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
