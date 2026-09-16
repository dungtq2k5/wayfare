/** Milliseconds in a day, for stream retention. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** How one JetStream stream is configured — the single definition (api-endpoints-plan §10). */
export interface StreamDefinition {
  readonly name: string;
  readonly subjects: readonly string[];
  readonly maxAgeMs: number;
  readonly duplicateWindowMs: number;
  readonly storage: 'file';
}

/**
 * Every stream in the system. Publishers and consumers both call `ensureStreams()` with these,
 * which creates a missing stream and verifies an existing one — never updates it.
 */
export const JETSTREAM_STREAMS = {
  AUDIT: {
    name: 'AUDIT',
    subjects: ['audit.record'],
    maxAgeMs: 7 * DAY_MS,
    duplicateWindowMs: 2 * 60 * 1000,
    storage: 'file',
  },
  // Dead letters are kept longer than events: they exist to be inspected.
  DLQ: {
    name: 'DLQ',
    subjects: ['dlq.>'],
    maxAgeMs: 30 * DAY_MS,
    duplicateWindowMs: 2 * 60 * 1000,
    storage: 'file',
  },
} as const satisfies Record<string, StreamDefinition>;

/** A declared stream name. */
export type StreamName = keyof typeof JETSTREAM_STREAMS;

/** The stream dead letters are copied to. */
export const DLQ_STREAM: StreamName = 'DLQ';

/** A durable consumer's name: `<service>-<subject with dots as dashes>`. Chosen once — renaming replays the stream. */
export function durableName(service: string, subject: string): string {
  return `${service}-${subject.replaceAll('.', '-')}`;
}

/** The dead-letter subject for one durable consumer. */
export function dlqSubject(service: string, consumer: string): string {
  return `dlq.${service}.${consumer}`;
}
