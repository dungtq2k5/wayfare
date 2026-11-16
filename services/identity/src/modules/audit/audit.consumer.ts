import { Injectable, Logger } from '@nestjs/common';
import { AUDIT_ALERT_ACTIONS, AUDIT_RECORD } from '@wayfare/contracts';
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
  private readonly alerts = new Logger('SecurityAlert');

  constructor(private readonly audit: AuditService) {
    super();
  }

  /**
   * Writes the row; an alert action (`AUDIT_ALERT_ACTIONS`) also logs an alerting error, once —
   * a redelivery that finds the row already written raises nothing new.
   */
  async handle(payload: AuditRecordPayload): Promise<void> {
    const written = await this.audit.record(payload);
    if (written && AUDIT_ALERT_ACTIONS.has(payload.action)) {
      this.alerts.error(
        { alert: true, action: payload.action, resourceId: payload.resource.id ?? null },
        'Security alert',
      );
    }
  }
}
