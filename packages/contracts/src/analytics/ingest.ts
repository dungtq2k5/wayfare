import { z } from 'zod';
import { AnalyticsEventType, AnalyticsTrigger, AudioTier, ConsentState } from './enums';

/** A heatmap cell with fewer devices is never written (rdm-spec A-3): at low counts it's a person. */
export const HEATMAP_MIN_DEVICES = 5;

/** The most events one batch carries (api-endpoints-plan §7). */
export const ANALYTICS_BATCH_MAX = 100;

/** How far back an event's clock is believed: an offline phone uploads a week at once (rdm-spec A-2). */
export const EVENT_CLOCK_PAST_MS = 7 * 24 * 60 * 60 * 1000;

/** How far ahead an event's clock is believed: a phone a few minutes fast. */
export const EVENT_CLOCK_FUTURE_MS = 5 * 60 * 1000;

/** How long a heatmap cell-hour counter is kept and re-counted: the clock's week plus a day. */
export const HEATMAP_KEY_TTL_SECONDS = 8 * 24 * 60 * 60;

/** How long a runtime area-hour counter is kept: its hour, and the flush after it. */
export const RUNTIME_KEY_TTL_SECONDS = 2 * 60 * 60;

/** The longest range a dashboard read covers, in business days (api-endpoints-plan §7). */
export const ANALYTICS_RANGE_MAX_DAYS = 93;

const HOUR_MS = 60 * 60 * 1000;

/** The start of the UTC hour an instant falls in. */
export const hourStart = (instant: Date): Date =>
  new Date(Math.floor(instant.getTime() / HOUR_MS) * HOUR_MS);

const HEATMAP_PREFIX = 'analytics:heatmap:';
const RUNTIME_PREFIX = 'analytics:runtime:';

/**
 * The HyperLogLog of one cell's devices in one UTC hour (rdm-spec A-3). Shared by the ingest that
 * adds to it and the flush that counts it, so neither spells it.
 */
export const heatmapKey = (cell: string, hour: Date): string =>
  `${HEATMAP_PREFIX}${hourStart(hour).getTime() / HOUR_MS}:${cell}`;

/**
 * The HyperLogLog of one Area's installs in one UTC hour (rdm-spec A-5): written by the gateway,
 * counted by analytics.
 */
export const runtimeKey = (areaId: string, hour: Date): string =>
  `${RUNTIME_PREFIX}${hourStart(hour).getTime() / HOUR_MS}:${areaId}`;

/** The patterns that find every counter of each kind (`SCAN MATCH`). */
export const HEATMAP_KEY_PATTERN = `${HEATMAP_PREFIX}*`;
export const RUNTIME_KEY_PATTERN = `${RUNTIME_PREFIX}*`;

/** A counter's hour and its cell or Area, or null for a key of another shape. */
export function parseCounterKey(key: string): { hour: Date; subject: string } | null {
  const rest = key.startsWith(HEATMAP_PREFIX)
    ? key.slice(HEATMAP_PREFIX.length)
    : key.startsWith(RUNTIME_PREFIX)
      ? key.slice(RUNTIME_PREFIX.length)
      : null;
  const match = rest === null ? null : /^(\d+):(.+)$/.exec(rest);
  if (match === null) return null;
  return { hour: new Date(Number(match[1]) * HOUR_MS), subject: match[2]! };
}

/** A geohash at precision 7 (~150 m), snapped on the device (rdm-spec A-3). */
export const zGeohashCell = z.string().regex(/^[0-9b-hjkmnp-z]{7}$/, 'a geohash-7 cell');

/** The field names that would carry a coordinate: refused anywhere in a batch (rdm-spec A-2). */
const COORDINATE_FIELDS: ReadonlySet<string> = new Set([
  'lat',
  'lng',
  'lon',
  'long',
  'latitude',
  'longitude',
  'coords',
  'coordinates',
]);

/** Whether a coordinate field appears at any depth of a value. */
export function hasCoordinateField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasCoordinateField);
  if (value === null || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, inner]) => COORDINATE_FIELDS.has(key.toLowerCase()) || hasCoordinateField(inner),
  );
}

const empty = z.strictObject({});

/**
 * Each event type's `props` (rdm-spec A-2 `AnalyticsEventProps`): what the columns don't hold, and
 * never a search's words, a coordinate or anything that names a person.
 */
export const ANALYTICS_EVENT_PROPS = {
  [AnalyticsEventType.APP_OPENED]: empty,
  [AnalyticsEventType.NARRATION_STARTED]: empty,
  [AnalyticsEventType.NARRATION_COMPLETED]: empty,
  [AnalyticsEventType.NARRATION_ABANDONED]: empty,
  [AnalyticsEventType.PLACE_OPENED]: empty,
  [AnalyticsEventType.QR_SCANNED]: z.strictObject({ target: z.enum(['PLACE', 'TOUR']).optional() }),
  [AnalyticsEventType.LANGUAGE_SELECTED]: empty,
  [AnalyticsEventType.PACK_INSTALLED]: z.strictObject({ areaId: z.uuid() }),
  [AnalyticsEventType.SEARCH_PERFORMED]: z.strictObject({
    resultCount: z.number().int().min(0).max(10_000),
  }),
  [AnalyticsEventType.TOUR_STARTED]: z.strictObject({ tourId: z.uuid() }),
  [AnalyticsEventType.VOUCHER_VIEWED]: empty,
} as const satisfies Record<AnalyticsEventType, z.ZodType>;

/** Each event type's props, as the client sends them. */
export type AnalyticsEventProps = {
  [K in AnalyticsEventType]: z.input<(typeof ANALYTICS_EVENT_PROPS)[K]>;
};

const NARRATIONS: ReadonlySet<AnalyticsEventType> = new Set([
  AnalyticsEventType.NARRATION_STARTED,
  AnalyticsEventType.NARRATION_COMPLETED,
  AnalyticsEventType.NARRATION_ABANDONED,
]);

/** One event as a client sends it (rdm-spec A-2). The location only ever as a cell. */
export const zAnalyticsEvent = z
  .strictObject({
    id: z.uuid(),
    sessionId: z.uuid(),
    type: z.enum(AnalyticsEventType),
    occurredAt: z.iso.datetime({ offset: true }),
    placeId: z.uuid().optional(),
    lang: z.string().min(2).max(16).optional(),
    trigger: z.enum(AnalyticsTrigger).optional(),
    audioTier: z.enum(AudioTier).optional(),
    listenMs: z
      .number()
      .int()
      .min(0)
      .max(24 * 60 * 60 * 1000)
      .optional(),
    cell: zGeohashCell.optional(),
    props: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((event, ctx) => {
    const props = ANALYTICS_EVENT_PROPS[event.type].safeParse(event.props);
    if (!props.success) ctx.addIssue({ code: 'custom', path: ['props'], message: 'props' });
    const narration = NARRATIONS.has(event.type);
    if (
      (narration || event.type === AnalyticsEventType.PLACE_OPENED) &&
      event.placeId === undefined
    )
      ctx.addIssue({ code: 'custom', path: ['placeId'], message: 'required' });
    if (event.type === AnalyticsEventType.NARRATION_STARTED) {
      if (event.trigger === undefined)
        ctx.addIssue({ code: 'custom', path: ['trigger'], message: 'required' });
      if (event.audioTier === undefined)
        ctx.addIssue({ code: 'custom', path: ['audioTier'], message: 'required' });
    }
    if (
      narration &&
      event.type !== AnalyticsEventType.NARRATION_STARTED &&
      event.listenMs === undefined
    )
      ctx.addIssue({ code: 'custom', path: ['listenMs'], message: 'required' });
    if (!narration && (event.trigger !== undefined || event.listenMs !== undefined))
      ctx.addIssue({ code: 'custom', path: ['trigger'], message: 'only on a narration' });
  });

/** A validated event. */
export type AnalyticsEvent = z.output<typeof zAnalyticsEvent>;

/**
 * A batch's envelope (api-endpoints-plan §7): the id and up to 100 events, each checked on its own
 * afterwards — one bad event is dropped, never the batch.
 */
export const zAnalyticsBatch = z.strictObject({
  analyticsDeviceId: z.uuid(),
  events: z
    .array(z.looseObject({ id: z.uuid() }))
    .min(1)
    .max(ANALYTICS_BATCH_MAX),
});

/** A consent decision (api-endpoints-plan §7). */
export const zAnalyticsConsent = z.strictObject({
  analyticsDeviceId: z.uuid(),
  state: z.enum(ConsentState),
  policyVersion: z.string().min(1).max(16),
});

/** The consent-free lane's report (rdm-spec A-5). */
export const zTelemetryActivity = z.strictObject({ areaId: z.uuid() });

/** An event's clock clamped to what the server believes (rdm-spec A-2). */
export function clampOccurredAt(occurredAt: Date, receivedAt: Date): Date {
  const earliest = receivedAt.getTime() - EVENT_CLOCK_PAST_MS;
  const latest = receivedAt.getTime() + EVENT_CLOCK_FUTURE_MS;
  return new Date(Math.min(Math.max(occurredAt.getTime(), earliest), latest));
}

/** The UTC instant a business day starts (Vietnam is UTC+7 all year, rdm-spec §2.2). */
export const businessDayStart = (day: string): Date => new Date(`${day}T00:00:00+07:00`);

/** The business day after `day`. */
export const nextBusinessDay = (day: string): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + 24 * HOUR_MS).toISOString().slice(0, 10);

/** Inclusive business days from `from` to `to`, oldest first; empty when `to` is before `from`. */
export function businessDaysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = nextBusinessDay(day)) days.push(day);
  return days;
}

/** A `YYYY-MM-DD` business day. */
export const zBusinessDay = z.iso.date();

/** A dashboard range's two fields: business days, inclusive. */
export const zAnalyticsRangeFields = { from: zBusinessDay, to: zBusinessDay };

/**
 * A dashboard's range checks (api-endpoints-plan §7): `from` not after `to`, at most 93 days — on
 * any object schema that carries the two fields.
 */
export function withRangeChecks<T extends z.ZodType<{ from: string; to: string }>>(schema: T): T {
  return schema
    .refine((range) => range.from <= range.to, { path: ['to'], message: 'Before from' })
    .refine(
      (range) => businessDaysBetween(range.from, range.to).length <= ANALYTICS_RANGE_MAX_DAYS,
      { path: ['to'], message: `At most ${ANALYTICS_RANGE_MAX_DAYS} days` },
    );
}

/** A dashboard's range. */
export const zAnalyticsRange = withRangeChecks(z.object(zAnalyticsRangeFields));

/**
 * A heatmap's hour band in Vietnam time (`18-24`): whole hours, the end exclusive. Its UTC hours
 * of day, which may cross midnight.
 */
export const zHourBand = z
  .string()
  .regex(/^\d{1,2}-\d{1,2}$/)
  .transform((band) => band.split('-').map(Number) as [number, number])
  .refine(([start, end]) => start >= 0 && start < end && end <= 24, 'start < end, within 0–24');

/** The UTC hours of day a Vietnam-time band covers (+7 h, no half hour, no daylight saving). */
export function utcHoursOfBand([start, end]: readonly [number, number]): number[] {
  const hours: number[] = [];
  for (let hour = start; hour < end; hour++) hours.push((hour - 7 + 24) % 24);
  return hours;
}
