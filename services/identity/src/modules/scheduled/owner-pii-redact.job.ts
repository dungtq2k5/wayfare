import { Injectable } from '@nestjs/common';
import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  OwnerRegistrationStatus,
} from '@wayfare/contracts';
import { OutboxService } from '@wayfare/nest-common';
import type { ScheduledJob } from '@wayfare/nest-common';
import { auditRecord } from '../audit/domain/audit-record';
import { redactionCutoff } from '../owner-registrations/domain/registration-status';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rows one transaction redacts; a run repeats until none is left. */
export const OWNER_PII_REDACT_BATCH = 200;

/**
 * Redacts national IDs past `PII_RETENTION_DAYS` (rdm-spec I-8): decided rows from `reviewed_at`,
 * withdrawn rows from `updated_at`, never a `PENDING` one. Each batch nulls the ciphertext and the
 * last four, stamps `pii_redacted_at`, and writes one `OWNER_PII_REDACTED` audit row per
 * registration in the same transaction.
 */
@Injectable()
export class OwnerPiiRedactJob implements ScheduledJob {
  readonly name = 'owner-pii-redact';
  readonly everyMs = DAY_MS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async run(now: Date = new Date()): Promise<{ redacted: number }> {
    const cutoff = redactionCutoff(now);
    const decided = [OwnerRegistrationStatus.APPROVED, OwnerRegistrationStatus.REJECTED];
    const withdrawn: string = OwnerRegistrationStatus.WITHDRAWN;
    let redacted = 0;
    for (;;) {
      const batch = await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`
          UPDATE owner_registrations
          SET national_id_ciphertext = NULL, national_id_last4 = NULL,
              pii_redacted_at = ${now}, updated_at = ${now}
          WHERE id IN (
            SELECT id FROM owner_registrations
            WHERE pii_redacted_at IS NULL
              AND ((status IN (${decided[0]}, ${decided[1]}) AND reviewed_at <= ${cutoff})
                OR (status = ${withdrawn} AND updated_at <= ${cutoff}))
            ORDER BY id
            LIMIT ${OWNER_PII_REDACT_BATCH}
            FOR UPDATE SKIP LOCKED)
          AND pii_redacted_at IS NULL
          RETURNING id`;
        await this.outbox.addMany(
          tx,
          AUDIT_RECORD,
          rows.map(({ id }) =>
            auditRecord({
              actor: { type: AuditActorType.SYSTEM },
              action: AuditAction.OWNER_PII_REDACTED,
              resource: { type: AuditResourceType.OWNER_REGISTRATION, id },
              origin: { ip: null, userAgent: null },
              now,
            }),
          ),
        );
        return rows.length;
      });
      redacted += batch;
      if (batch < OWNER_PII_REDACT_BATCH) return { redacted };
    }
  }
}
