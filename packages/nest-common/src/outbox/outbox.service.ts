import { newId } from '@wayfare/contracts';
import type { EventDefinition, EventInput, EventPayload } from '@wayfare/contracts';
import { currentTraceparent } from '../observability/trace';
import type { OutboxTx } from '../prisma/helpers';

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
    const id = newId();
    const payload = event.schema.parse({ ...input, eventId: id }) as EventPayload<Definition>;
    await tx.outboxEvent.create({
      data: {
        id,
        subject: event.subject,
        payload,
        aggregateId: event.aggregateId(payload),
        traceParent: currentTraceparent(),
      },
      select: { id: true },
    });
    return payload;
  }
}
