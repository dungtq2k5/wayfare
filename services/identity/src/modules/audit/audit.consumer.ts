import { Injectable } from '@nestjs/common';
import { AUDIT_RECORD } from '@wayfare/contracts';
import type { AuditRecordPayload } from '@wayfare/contracts';
import { JetStreamConsumer } from '@wayfare/nest-common';
import { SERVICE_NAME } from '../outbox/outbox.module';
import { AuditService } from './audit.service';

/**
 * Consumes `audit.record` into `audit_logs`. The runner validates the payload; this delegates once.
 * Idempotent through `audit_logs.event_id UNIQUE` — no `processed_events` table.
 */
@Injectable()
export class AuditConsumer extends JetStreamConsumer<typeof AUDIT_RECORD> {
  readonly event = AUDIT_RECORD;
  readonly service: string = SERVICE_NAME;

  constructor(private readonly audit: AuditService) {
    super();
  }

  async handle(payload: AuditRecordPayload): Promise<void> {
    await this.audit.record(payload);
  }
}
