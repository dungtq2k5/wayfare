import { withRangeChecks, zAnalyticsRangeFields, zUuidV7 } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `?from=&to=`: business days, inclusive, at most 93 (api-endpoints-plan §7). */
export const ownerStatsQuerySchema = withRangeChecks(z.object(zAnalyticsRangeFields).strict());

/** The range. */
export class OwnerStatsQueryDto extends createZodDto(ownerStatsQuerySchema) {}

/** The export's range and its header language. */
export const ownerStatsExportQuerySchema = withRangeChecks(
  z.object({ ...zAnalyticsRangeFields, lang: z.enum(['en', 'vi']).default('en') }).strict(),
);

/** The export's query. */
export class OwnerStatsExportQueryDto extends createZodDto(ownerStatsExportQuerySchema) {}

/** `/owner/stats/places/:id`. */
export const ownerStatsPlaceParamSchema = z.object({ id: zUuidV7 }).strict();

/** A Venue's id. */
export class OwnerStatsPlaceParamDto extends createZodDto(ownerStatsPlaceParamSchema) {}
