import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * What a link answers about its account (api-endpoints-plan §1.2): the address masked, for the
 * result's text, and whether the caller's bearer is that account — masked addresses collide.
 */
export const linkAnswerResponseSchema = z.object({
  emailMasked: z.string(),
  sameAccount: z.boolean(),
});

/** What `POST /auth/email/verify`, `…/change/confirm` and `…/change/revert` return under `data`. */
export class LinkAnswerResponseDto extends createZodDto(linkAnswerResponseSchema) {}
