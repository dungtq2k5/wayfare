import { newId } from '@wayfare/contracts';
import type { EventDefinition, EventInput, EventPayload } from '@wayfare/contracts';
import { currentTraceparent } from '../observability/trace';
import type { OutboxBatchTx, OutboxEventCreateData, OutboxTx } from '../prisma/helpers';

/** Rows one `addMany` statement inserts. */
export const OUTBOX_INSERT_BATCH_SIZE = 100;

/**
 * Writes events to `outbox_events` inside the business transaction that caused them (ADR 0039).
 * Subject-agnostic: it generates the id, injects it as `eventId`, validates against the
 * subject's schema — a bad payload fails the business write — and captures the trace.
 */
export class OutboxService {
  /** Inserts one event and returns the validated payload. Always pass the transaction's `tx`. */
  async add<Definition extends EventDefinition>(
    tx: OutboxTx,
    event: Definition,
    input: EventInput<Definition>,
  ): Promise<EventPayload<Definition>> {
    const row = outboxRow(event, input);
    await tx.outboxEvent.create({ data: row, select: { id: true } });
    return row.payload as EventPayload<Definition>;
  }

  /**
   * Inserts several events of one subject, `OUTBOX_INSERT_BATCH_SIZE` rows per statement, in input order.
   * Every payload is validated before the first insert, so a bad one writes nothing.
   */
  async addMany<Definition extends EventDefinition>(
    tx: OutboxBatchTx,
    event: Definition,
    inputs: readonly EventInput<Definition>[],
  ): Promise<EventPayload<Definition>[]> {
    const rows = inputs.map((input) => outboxRow(event, input));
    for (let start = 0; start < rows.length; start += OUTBOX_INSERT_BATCH_SIZE) {
      await tx.outboxEvent.createMany({
        data: rows.slice(start, start + OUTBOX_INSERT_BATCH_SIZE),
      });
    }
    return rows.map((row) => row.payload as EventPayload<Definition>);
  }
}

/** One validated row; the generated id doubles as `eventId`. */
function outboxRow<Definition extends EventDefinition>(
  event: Definition,
  input: EventInput<Definition>,
): OutboxEventCreateData {
  const id = newId();
  const payload = event.schema.parse({ ...input, eventId: id }) as EventPayload<Definition>;
  return {
    id,
    subject: event.subject,
    payload: payload,
    aggregateId: event.aggregateId(payload),
    traceParent: currentTraceparent(),
  };
}
