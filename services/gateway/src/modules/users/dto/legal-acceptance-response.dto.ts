import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { legalAcceptanceResponseSchema } from '../../devices/dto/device-response.dto';

/** One entry of `GET /users/me/legal-acceptances`: the newest per party and document (api-endpoints-plan §1.3). */
export const legalAcceptanceStatusResponseSchema = legalAcceptanceResponseSchema.extend({
  /** Whether it is the document's current version — `false` means re-prompt. */
  current: z.boolean(),
});

/** What `GET /users/me/legal-acceptances` returns, per entry, under `data`. */
export class LegalAcceptanceStatusResponseDto extends createZodDto(
  legalAcceptanceStatusResponseSchema,
) {}
