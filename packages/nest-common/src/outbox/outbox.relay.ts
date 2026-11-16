import { Logger } from '@nestjs/common';
import { SENSITIVE_SUBJECTS } from '@wayfare/contracts';
import { context, propagation, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { toErrorMessage } from '../errors/poison-message';
import { contextFromTraceparent, wayfareTracer } from '../observability/trace';
import type { RawSqlTx, RelayDb } from '../prisma/helpers';

/** How often the relay polls when the last batch was not full. */
export const OUTBOX_POLL_MS = 200;
/** Rows claimed per cycle. */
export const OUTBOX_BATCH_SIZE = 50;
/** Upper bound of one publish. */
export const OUTBOX_PUBLISH_TIMEOUT_MS = 2_000;
/**
 * The claim transaction stays open for the whole batch, so its timeout is derived from the two
 * above — never configured separately (Prisma's 5 s default would expire on a slow broker).
 */
export const OUTBOX_TX_TIMEOUT_MS = OUTBOX_BATCH_SIZE * OUTBOX_PUBLISH_TIMEOUT_MS + 5_000;
/** Cap of the exponential backoff after consecutive failed cycles. */
export const OUTBOX_MAX_BACKOFF_MS = 30_000;

/** Publishes one message to JetStream; resolves once the broker acknowledged it. */
export interface EventPublisher {
  publish(
    subject: string,
    data: Uint8Array,
    options: { msgId: string; headers: Record<string, string>; timeoutMs: number },
  ): Promise<void>;
}

/** The result of one relay cycle. */
export interface RelayCycleResult {
  readonly claimed: number;
  readonly published: number;
  readonly failed: boolean;
}

interface ClaimedRow {
  id: string;
  subject: string;
  payload: unknown;
  trace_parent: string | null;
}

const encoder = new TextEncoder();

/**
 * The outbox relay (rdm-spec §2.10, ADR 0039): claims unpublished rows with `SKIP LOCKED`,
 * publishes them in `id` order with `Nats-Msg-Id = id`, and marks them published.
 *
 * Order holds within one cycle and is best-effort across replicas. A crash between publish and
 * mark republishes the row — deduplicated by the broker inside its window, absorbed by consumers
 * outside it. That is by design.
 *
 * A sensitive subject's payload is cleared in the statement that marks the row published, so the
 * broker's copy is the only one left (conventions §9.1). Rows are marked only after the broker's
 * ack, so a cleared row is never republished.
 */
export class OutboxRelay {
  private readonly logger = new Logger(OutboxRelay.name);
  private running = false;
  private loop: Promise<void> | null = null;
  private wake: (() => void) | null = null;

  constructor(
    private readonly db: RelayDb,
    private readonly publisher: EventPublisher,
    private readonly sensitiveSubjects: ReadonlySet<string> = SENSITIVE_SUBJECTS,
  ) {}

  /** Starts the poll loop in the background. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.run();
  }

  /** Stops the loop and waits for the current cycle to finish. */
  async stop(): Promise<void> {
    this.running = false;
    this.wake?.();
    await this.loop;
    this.loop = null;
  }

  /** Runs exactly one claim → publish → mark cycle. Public so tests drive it without timers. */
  runOnce(): Promise<RelayCycleResult> {
    return this.db.$transaction((tx) => this.cycle(tx), { timeout: OUTBOX_TX_TIMEOUT_MS });
  }

  private async run(): Promise<void> {
    let consecutiveFailures = 0;
    while (this.running) {
      let delay = OUTBOX_POLL_MS;
      try {
        const result = await this.runOnce();
        if (result.failed) {
          consecutiveFailures++;
        } else {
          consecutiveFailures = 0;
          if (result.claimed === OUTBOX_BATCH_SIZE) delay = 0; // a full batch: more are waiting
        }
      } catch (error) {
        consecutiveFailures++;
        this.logger.warn({ err: toErrorMessage(error) }, 'outbox relay cycle failed');
      }
      if (consecutiveFailures > 0) {
        delay = Math.min(OUTBOX_POLL_MS * 2 ** consecutiveFailures, OUTBOX_MAX_BACKOFF_MS);
      }
      if (delay > 0 && this.running) await this.sleep(delay);
    }
  }

  private async cycle(tx: RawSqlTx): Promise<RelayCycleResult> {
    // Physical column names: this is raw SQL, proven by its own integration test.
    const rows = await tx.$queryRaw<ClaimedRow[]>`
      SELECT id::text AS id, subject, payload, trace_parent
      FROM outbox_events
      WHERE published_at IS NULL
      ORDER BY id
      LIMIT ${OUTBOX_BATCH_SIZE}
      FOR UPDATE SKIP LOCKED`;

    const published: string[] = [];
    const cleared: string[] = [];
    let failed = false;
    for (const row of rows) {
      try {
        await this.publishRow(row);
        published.push(row.id);
        if (this.sensitiveSubjects.has(row.subject)) cleared.push(row.id);
      } catch (error) {
        failed = true;
        const message = toErrorMessage(error).slice(0, 1_000);
        await tx.$executeRaw`
          UPDATE outbox_events
          SET attempts = attempts + 1, last_error = ${message}
          WHERE id = ${row.id}::uuid`;
        this.logger.warn(
          { outboxId: row.id, subject: row.subject, err: message },
          'outbox publish failed',
        );
        break; // stop at the first failure so the rows behind it keep their order
      }
    }
    if (published.length > 0) {
      await tx.$executeRaw`
        UPDATE outbox_events
        SET published_at = now(), attempts = attempts + 1, last_error = NULL,
            payload = CASE WHEN id = ANY(${cleared}::uuid[]) THEN '{}'::jsonb ELSE payload END
        WHERE id = ANY(${published}::uuid[])`;
    }
    return { claimed: rows.length, published: published.length, failed };
  }

  private publishRow(row: ClaimedRow): Promise<void> {
    const parent = contextFromTraceparent(row.trace_parent);
    return wayfareTracer.startActiveSpan(
      `publish ${row.subject}`,
      {
        kind: SpanKind.PRODUCER,
        attributes: {
          'messaging.system': 'nats',
          'messaging.destination.name': row.subject,
          'messaging.message.id': row.id,
        },
      },
      parent,
      async (span) => {
        try {
          // The consumer's span becomes a child of this publish span, which is a child of the request.
          const headers: Record<string, string> = {};
          propagation.inject(context.active(), headers);
          await this.publisher.publish(row.subject, encoder.encode(JSON.stringify(row.payload)), {
            msgId: row.id,
            headers,
            timeoutMs: OUTBOX_PUBLISH_TIMEOUT_MS,
          });
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: toErrorMessage(error) });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wake = null;
        resolve();
      }, ms);
      this.wake = () => {
        clearTimeout(timer);
        this.wake = null;
        resolve();
      };
    });
  }
}
