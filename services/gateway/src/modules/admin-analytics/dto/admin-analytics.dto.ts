import { withRangeChecks, zAnalyticsRangeFields, zHourBand } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `?from=&to=`: business days, inclusive, at most 93 (api-endpoints-plan §7). */
export const adminAnalyticsRangeQuerySchema = withRangeChecks(
  z.object(zAnalyticsRangeFields).strict(),
);

/** The overview's range. */
export class AdminAnalyticsRangeQueryDto extends createZodDto(adminAnalyticsRangeQuerySchema) {}

/** The top Places' query: the range, what to rank by, how many (at most 50). */
export const adminTopPlacesQuerySchema = withRangeChecks(
  z
    .object({
      ...zAnalyticsRangeFields,
      metric: z.enum(['completed', 'started', 'listenMs']).default('completed'),
      limit: z.coerce.number().int().min(1).max(50).default(10),
    })
    .strict(),
);

/** The top Places' query. */
export class AdminTopPlacesQueryDto extends createZodDto(adminTopPlacesQuerySchema) {}

/** The heatmap's query: an Area, the range, the hours of day in Vietnam time (`18-24`). */
export const adminHeatmapQuerySchema = withRangeChecks(
  z
    .object({
      ...zAnalyticsRangeFields,
      areaId: z.uuid(),
      hours: z.string().default('0-24').pipe(zHourBand),
    })
    .strict(),
);

/** The heatmap's query. */
export class AdminHeatmapQueryDto extends createZodDto(adminHeatmapQuerySchema) {}

/** The runtime lane's query: one Area's last hours (≤ 72), or `current=true` for every Area now. */
export const adminRuntimeQuerySchema = z
  .object({
    areaId: z.uuid().optional(),
    hours: z.coerce.number().int().min(1).max(72).default(24),
    current: z.enum(['true', 'false']).default('false'),
  })
  .strict()
  .refine((query) => query.current === 'true' || query.areaId !== undefined, {
    path: ['areaId'],
    message: 'An Area, unless current=true',
  });

/** The runtime lane's query. */
export class AdminRuntimeQueryDto extends createZodDto(adminRuntimeQuerySchema) {}
