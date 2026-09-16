import type { z } from 'zod';
import type { StreamName } from './streams';

/** A declared JetStream subject with its payload schema. A subject not declared this way does not exist. */
export interface EventDefinition<
  Schema extends z.ZodType<{ eventId: string }> = z.ZodType<{ eventId: string }>,
> {
  readonly subject: string;
  readonly stream: StreamName;
  readonly schema: Schema;
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

/** Declares an event, keeping its schema's type. */
export function defineEvent<Schema extends z.ZodType<{ eventId: string }>>(
  definition: EventDefinition<Schema>,
): EventDefinition<Schema> {
  return definition;
}
