import {
  hasCoordinateField,
  zAnalyticsBatch,
  zAnalyticsConsent,
  zTelemetryActivity,
} from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';

/** `POST /analytics/consent` body (api-endpoints-plan §7). */
export class AnalyticsConsentDto extends createZodDto(zAnalyticsConsent) {}

/**
 * `POST /analytics/events` body: the envelope, and no coordinate anywhere — the whole batch is
 * refused. Each event is checked by analytics, a bad one dropped.
 */
export const analyticsEventsSchema = zAnalyticsBatch.refine(
  (batch) => !hasCoordinateField(batch.events),
  { path: ['events'], message: 'No coordinates: a location travels only as a cell' },
);

/** The batch, as checked here. */
export class AnalyticsEventsDto extends createZodDto(analyticsEventsSchema) {}

/** `POST /telemetry/activity` body — the consent-free lane (rdm-spec A-5). */
export class TelemetryActivityDto extends createZodDto(zTelemetryActivity) {}
