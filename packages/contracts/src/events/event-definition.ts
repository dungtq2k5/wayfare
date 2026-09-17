import { z } from 'zod';
import { zUuidV7 } from '../common/ids';
import { JETSTREAM_STREAMS, streamsForSubject } from './streams';
import type { StreamName } from './streams';

/** The services that publish events; `any` is the two subjects every service publishes. */
export type EventPublisher = 'identity' | 'catalog' | 'narration' | 'billing' | 'any';

/** The stream each named publisher writes to (api-endpoints-plan §10). */
export const PUBLISHER_STREAM = {
  identity: 'IDENTITY',
  catalog: 'CATALOG',
  narration: 'NARRATION',
  billing: 'BILLING',
} as const satisfies Record<Exclude<EventPublisher, 'any'>, StreamName>;

/** A declared JetStream subject with its payload schema. A subject not declared this way does not exist. */
export interface EventDefinition<
  Schema extends z.ZodType<{ eventId: string }> = z.ZodType<{ eventId: string }>,
> {
  readonly subject: string;
  /** Who publishes it — `any` only for `audit.record` and `notification.create`. */
  readonly publisher: EventPublisher;
  readonly stream: StreamName;
  readonly schema: Schema;
  /**
   * The payload carries a secret: log-redacted, and cleared from the outbox row in the statement
   * that marks it published (conventions §9.1).
   */
  readonly sensitive?: true;
  /** The row the event is about — `outbox_events.aggregate_id` (rdm-spec §2.10). */
  aggregateId(payload: z.output<Schema>): string;
}

/** The payload a producer supplies — everything except `eventId`, which `outbox.add` injects. */
export type EventInput<Definition extends EventDefinition> = Omit<
  z.input<Definition['schema']>,
  'eventId'
>;

/** The validated payload a consumer receives. */
export type EventPayload<Definition extends EventDefinition> = z.output<Definition['schema']>;

/** Thrown at import time for a definition that breaks the event conventions — a bug, never data. */
export class EventDefinitionError extends Error {
  constructor(subject: string, reason: string) {
    super(`Event ${subject}: ${reason}`);
    this.name = 'EventDefinitionError';
  }
}

const V4_PROBE = '018f0000-0000-4000-8000-000000000000';
const V7_PROBE = '018f0000-0000-7000-8000-000000000000';

const SUBJECT_PATTERN = /^[a-z]+\.[a-z_]+\.[a-z_]+$/;

function assertStrictWithEventId(subject: string, schema: z.ZodType): void {
  if (!(schema instanceof z.ZodObject))
    throw new EventDefinitionError(subject, 'the schema is not an object');
  if (!(schema.def.catchall instanceof z.ZodNever))
    throw new EventDefinitionError(subject, 'the schema is not .strict()');
  const eventId = schema.shape.eventId as z.ZodType | undefined;
  if (eventId === undefined) throw new EventDefinitionError(subject, 'the schema has no eventId');
  if (eventId.safeParse(V4_PROBE).success || !eventId.safeParse(V7_PROBE).success) {
    throw new EventDefinitionError(subject, 'eventId must be a zUuidV7');
  }
}

/**
 * Declares an event, keeping its schema's type. Asserts the subject is `<publisher>.<aggregate>.<verb>`
 * for a named publisher, the stream is the publisher's own (or, for `any`, the one stream matching the
 * subject), and the schema is a strict object with a UUIDv7 `eventId` (api-endpoints-plan §10).
 */
export function defineEvent<Schema extends z.ZodType<{ eventId: string }>>(
  definition: EventDefinition<Schema>,
): EventDefinition<Schema> {
  const { subject, publisher, stream } = definition;
  if (publisher === 'any') {
    const matching = streamsForSubject(subject);
    if (
      matching.length !== 1 ||
      matching[0] !== stream ||
      JETSTREAM_STREAMS[stream].subjects[0] !== subject
    ) {
      throw new EventDefinitionError(
        subject,
        `an every-service subject needs its own stream, not ${stream}`,
      );
    }
  } else {
    if (!SUBJECT_PATTERN.test(subject) || !subject.startsWith(`${publisher}.`)) {
      throw new EventDefinitionError(
        subject,
        `the subject must be ${publisher}.<aggregate>.<verb>`,
      );
    }
    if (stream !== PUBLISHER_STREAM[publisher]) {
      throw new EventDefinitionError(
        subject,
        `${publisher} publishes to ${PUBLISHER_STREAM[publisher]}, not ${stream}`,
      );
    }
  }
  assertStrictWithEventId(subject, definition.schema);
  return definition;
}

/** An instant in an event payload (api-endpoints-plan §10). */
export const zEventInstant = z.iso.datetime({ offset: true });

/** A SHA-256 hex digest — a content hash or a file checksum. */
export const zSha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * A payload schema: strict, with the `eventId` `outbox.add` injects and the `occurredAt` every
 * payload carries, then the subject's own fields — ids, versions and short values only.
 */
export function eventSchema<Shape extends z.ZodRawShape>(shape: Shape) {
  return z.object({ eventId: zUuidV7, occurredAt: zEventInstant, ...shape }).strict();
}
