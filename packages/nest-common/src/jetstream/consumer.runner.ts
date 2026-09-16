import { Logger } from '@nestjs/common';
import { AckPolicy, DeliverPolicy } from '@nats-io/jetstream';
import type { ConsumerMessages } from '@nats-io/jetstream';
import { nanos } from '@nats-io/transport-node';
import { propagation, ROOT_CONTEXT, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { dlqSubject, durableName, isUuidV7, JETSTREAM_STREAMS } from '@wayfare/contracts';
import type { EventDefinition, EventPayload } from '@wayfare/contracts';
import { PoisonMessage, toErrorMessage } from '../errors/poison-message';
import { headerGetter, wayfareTracer } from '../observability/trace';
import type { HeaderBag } from '../observability/trace';
import type { NatsClient } from './nats.client';

/** Deliveries before a message is dead-lettered. */
export const MAX_DELIVER = 10;
/** Longer than any handler's slowest legitimate run. */
export const ACK_WAIT_MS = 30_000;
/**
 * Server-side: when an UN-acknowledged message comes back. Each entry replaces `ack_wait` for that
 * attempt, so none may be shorter than the slowest legitimate run.
 */
export const BACKOFF_MS = [30_000, 60_000, 120_000, 300_000, 600_000] as const;
/** Runner-side: how soon a message the handler explicitly failed comes back, via `nak(delay)`. */
export const NAK_DELAYS_MS = [1_000, 5_000, 30_000, 120_000, 300_000] as const;

/** Header names added to a dead letter. */
export const DLQ_HEADERS = {
  error: 'Wf-Dlq-Error',
  subject: 'Wf-Dlq-Original-Subject',
  deliveryCount: 'Wf-Dlq-Delivery-Count',
  messageId: 'Wf-Dlq-Original-Msg-Id',
} as const;

/** Metadata about the message being handled. */
export interface ConsumedMessageInfo {
  readonly subject: string;
  readonly messageId: string;
  readonly deliveryCount: number;
}

/**
 * A durable JetStream consumer (conventions §7.2). Subclasses validate nothing themselves — the
 * runner parses the payload with the event's schema — and delegate once to a service.
 *
 * Idempotency keys on `payload.eventId`, never on the header: a replay under a new
 * `Nats-Msg-Id` must still be absorbed.
 */
export abstract class JetStreamConsumer<Definition extends EventDefinition = EventDefinition> {
  /** The publishing service's event this consumer reads. */
  abstract readonly event: Definition;
  /** The consuming service — the first part of the durable name. */
  abstract readonly service: string;

  /** Applies the event. `return` = done (including "already applied"); throw = retry; `PoisonMessage` = dead-letter. */
  abstract handle(payload: EventPayload<Definition>, info: ConsumedMessageInfo): Promise<void>;

  /** `<service>-<subject with dots as dashes>` — chosen once; renaming replays the stream. */
  get durable(): string {
    return durableName(this.service, this.event.subject);
  }
}

/** The subset of a JetStream message the runner uses. */
export interface RunnerMessage {
  readonly subject: string;
  readonly data: Uint8Array;
  readonly headers?: HeaderBag;
  readonly info: { readonly deliveryCount: number };
  ack(): void;
  nak(millis?: number): void;
  term(reason?: string): void;
}

/** Publishes a dead letter. */
export interface DeadLetterPublisher {
  publish(
    subject: string,
    data: Uint8Array,
    options: { headers: Record<string, string>; timeoutMs: number },
  ): Promise<void>;
}

/** The outcome of handling one message — returned for tests. */
export type MessageOutcome = 'acked' | 'nacked' | 'dead-lettered';

const decoder = new TextDecoder();

/**
 * Runs durable pull consumers with the three-outcome contract and the dead-letter rules
 * (conventions §7.2, api-endpoints-plan §10). Nest's NATS transport is core-only and never sees a JetStream message.
 */
export class ConsumerRunner {
  private readonly logger = new Logger(ConsumerRunner.name);
  private readonly running: ConsumerMessages[] = [];
  private readonly loops: Promise<void>[] = [];

  constructor(private readonly nats: NatsClient) {}

  /**
   * Creates (or verifies) each durable consumer and starts consuming. Production consumers read
   * the whole stream; `deliverPolicy: 'new'` exists so a test durable never replays shared history.
   */
  async start(
    consumers: readonly JetStreamConsumer[],
    options: { deliverPolicy?: 'all' | 'new' } = {},
  ): Promise<void> {
    for (const consumer of consumers) {
      const stream = JETSTREAM_STREAMS[consumer.event.stream].name;
      // `add` is idempotent for an identical config and refuses a different one.
      await this.nats.jsm.consumers.add(stream, {
        durable_name: consumer.durable,
        filter_subject: consumer.event.subject,
        ack_policy: AckPolicy.Explicit,
        deliver_policy: options.deliverPolicy === 'new' ? DeliverPolicy.New : DeliverPolicy.All,
        max_deliver: MAX_DELIVER,
        ack_wait: nanos(ACK_WAIT_MS),
        backoff: BACKOFF_MS.map((ms) => nanos(ms)),
      });
      const pull = await this.nats.js.consumers.get(stream, consumer.durable);
      const messages = await pull.consume({ max_messages: 10 });
      this.running.push(messages);
      this.loops.push(this.drain(consumer, messages));
    }
  }

  /** Stops every consumer and waits for in-flight messages. */
  async stop(): Promise<void> {
    await Promise.all(this.running.map((messages) => messages.close()));
    await Promise.all(this.loops);
    this.running.length = 0;
    this.loops.length = 0;
  }

  private async drain(consumer: JetStreamConsumer, messages: ConsumerMessages): Promise<void> {
    for await (const message of messages) {
      await handleMessage(consumer, message, this.nats, this.logger);
    }
  }
}

/**
 * Handles one message: validate → run inside the producer's trace → ack, nak or dead-letter.
 * Exported so the four outcomes are unit-tested without NATS.
 */
export async function handleMessage(
  consumer: JetStreamConsumer,
  message: RunnerMessage,
  dlq: DeadLetterPublisher,
  logger: Pick<Logger, 'warn' | 'error'> = new Logger(ConsumerRunner.name),
): Promise<MessageOutcome> {
  const deliveryCount = message.info.deliveryCount;
  const messageId = message.headers?.get('Nats-Msg-Id') ?? '';
  const parent = message.headers
    ? propagation.extract(ROOT_CONTEXT, message.headers, headerGetter)
    : ROOT_CONTEXT;

  return wayfareTracer.startActiveSpan(
    `process ${message.subject}`,
    {
      kind: SpanKind.CONSUMER,
      attributes: {
        'messaging.system': 'nats',
        'messaging.destination.name': message.subject,
        'messaging.message.id': messageId,
        'messaging.consumer.group.name': consumer.durable,
      },
    },
    parent,
    async (span) => {
      try {
        const payload = parsePayload(consumer, message, messageId);
        await consumer.handle(payload, { subject: message.subject, messageId, deliveryCount });
        message.ack();
        return 'acked';
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: toErrorMessage(error) });
        const poison = error instanceof PoisonMessage;
        if (poison || deliveryCount >= MAX_DELIVER) {
          return deadLetter(consumer, message, dlq, error, logger, messageId);
        }
        const delay =
          NAK_DELAYS_MS[Math.min(deliveryCount - 1, NAK_DELAYS_MS.length - 1)] ?? NAK_DELAYS_MS[0];
        logger.warn(
          { durable: consumer.durable, messageId, deliveryCount, err: toErrorMessage(error) },
          'consumer failed; retrying',
        );
        message.nak(delay);
        return 'nacked';
      } finally {
        span.end();
      }
    },
  );
}

function parsePayload<Definition extends EventDefinition>(
  consumer: JetStreamConsumer<Definition>,
  message: RunnerMessage,
  messageId: string,
): EventPayload<Definition> {
  if (!isUuidV7(messageId)) throw new PoisonMessage('Nats-Msg-Id is not a UUIDv7');
  let raw: unknown;
  try {
    raw = JSON.parse(decoder.decode(message.data));
  } catch {
    throw new PoisonMessage('payload is not JSON');
  }
  const result = consumer.event.schema.safeParse(raw);
  if (!result.success) {
    throw new PoisonMessage(
      `payload fails its schema: ${result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.code}`).join('; ')}`,
    );
  }
  return result.data as EventPayload<Definition>;
}

async function deadLetter(
  consumer: JetStreamConsumer,
  message: RunnerMessage,
  dlq: DeadLetterPublisher,
  error: unknown,
  logger: Pick<Logger, 'warn' | 'error'>,
  messageId: string,
): Promise<MessageOutcome> {
  const headers: Record<string, string> = {};
  for (const key of message.headers?.keys() ?? []) {
    // The original id is kept under its own name: reusing Nats-Msg-Id would dedupe dead letters.
    if (key.toLowerCase() !== 'nats-msg-id') headers[key] = message.headers?.get(key) ?? '';
  }
  headers[DLQ_HEADERS.error] = toErrorMessage(error).slice(0, 1_000);
  headers[DLQ_HEADERS.subject] = message.subject;
  headers[DLQ_HEADERS.deliveryCount] = String(message.info.deliveryCount);
  headers[DLQ_HEADERS.messageId] = messageId;
  try {
    await dlq.publish(dlqSubject(consumer.service, consumer.durable), message.data, {
      headers,
      timeoutMs: 2_000,
    });
  } catch (publishError) {
    // Never term a message whose dead letter was not written: it would vanish.
    logger.error(
      { durable: consumer.durable, messageId, err: toErrorMessage(publishError) },
      'dead-letter publish failed',
    );
    message.nak(NAK_DELAYS_MS[0]);
    return 'nacked';
  }
  logger.error(
    { durable: consumer.durable, messageId, err: toErrorMessage(error) },
    'message dead-lettered',
  );
  message.term(toErrorMessage(error).slice(0, 200));
  return 'dead-lettered';
}
