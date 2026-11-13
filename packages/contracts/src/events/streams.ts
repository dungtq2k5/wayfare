import { DLQ_MAX_AGE_MS, EVENT_STREAM_MAX_AGE_MS } from '../limits/retention';

const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

/** How one JetStream stream is configured — the single definition (api-endpoints-plan §10). */
export interface StreamDefinition {
  readonly name: string;
  readonly subjects: readonly string[];
  readonly maxAgeMs: number;
  readonly duplicateWindowMs: number;
  readonly storage: 'file';
}

function eventStream<N extends string, S extends string>(name: N, subject: S) {
  return {
    name,
    subjects: [subject],
    maxAgeMs: EVENT_STREAM_MAX_AGE_MS,
    duplicateWindowMs: DUPLICATE_WINDOW_MS,
    storage: 'file',
  } as const;
}

/**
 * Every stream in the system: one per publisher, one per every-service subject, and the dead
 * letters (api-endpoints-plan §10). Publishers and consumers both call `ensureStreams()` with these,
 * which creates a missing stream and verifies an existing one — never updates it. A publisher's
 * wildcard means a new subject needs no stream change.
 */
export const JETSTREAM_STREAMS = {
  IDENTITY: eventStream('IDENTITY', 'identity.>'),
  CATALOG: eventStream('CATALOG', 'catalog.>'),
  NARRATION: eventStream('NARRATION', 'narration.>'),
  BILLING: eventStream('BILLING', 'billing.>'),
  AUDIT: eventStream('AUDIT', 'audit.record'),
  NOTIFICATION: eventStream('NOTIFICATION', 'notification.create'),
  // Dead letters are kept longer than events: they exist to be inspected.
  DLQ: {
    name: 'DLQ',
    subjects: ['dlq.>'],
    maxAgeMs: DLQ_MAX_AGE_MS,
    duplicateWindowMs: DUPLICATE_WINDOW_MS,
    storage: 'file',
  },
} as const satisfies Record<string, StreamDefinition>;

/** A declared stream name. */
export type StreamName = keyof typeof JETSTREAM_STREAMS;

/** Every declared stream name. */
export const STREAM_NAMES = Object.keys(JETSTREAM_STREAMS) as StreamName[];

/** The stream dead letters are copied to. */
export const DLQ_STREAM: StreamName = 'DLQ';

/**
 * True when a NATS subject filter matches a concrete subject: `*` is one token, and a trailing `>`
 * is one or more.
 */
export function subjectMatches(filter: string, subject: string): boolean {
  const filterTokens = filter.split('.');
  const subjectTokens = subject.split('.');
  for (const [index, token] of filterTokens.entries()) {
    if (token === '>') return index === filterTokens.length - 1 && subjectTokens.length > index;
    if (index >= subjectTokens.length) return false;
    if (token !== '*' && token !== subjectTokens[index]) return false;
  }
  return filterTokens.length === subjectTokens.length;
}

/** The streams whose filters match a subject. A declared event subject has exactly one. */
export function streamsForSubject(subject: string): StreamName[] {
  return STREAM_NAMES.filter((name) =>
    JETSTREAM_STREAMS[name].subjects.some((filter) => subjectMatches(filter, subject)),
  );
}

/** A durable consumer's name: `<service>-<subject with dots as dashes>`. Chosen once — renaming replays the stream. */
export function durableName(service: string, subject: string): string {
  return `${service}-${subject.replaceAll('.', '-')}`;
}

/** The dead-letter subject for one durable consumer. */
export function dlqSubject(service: string, consumer: string): string {
  return `dlq.${service}.${consumer}`;
}
