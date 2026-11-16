import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** What `POST /analytics/events` came to: stored, already stored, dropped. */
export const analyticsEventsResponseSchema = z
  .object({
    stored: z.number().int().min(0),
    duplicates: z.number().int().min(0),
    dropped: z.number().int().min(0),
  })
  .strict();

/** A batch's outcome. */
export class AnalyticsEventsResponseDto extends createZodDto(analyticsEventsResponseSchema) {}
