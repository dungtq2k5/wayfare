import { Injectable } from '@nestjs/common';
import type { AuditRecordPayload } from '@wayfare/contracts';
import { isUniqueConstraintViolation } from '@wayfare/nest-common';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Writes `audit.record` events into `audit_logs` (rdm-spec I-11). */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Inserts one audit row keyed on the producer's `eventId`. A redelivery hits the unique index
   * and is treated as already applied — idempotent without a `processed_events` row.
   * @returns whether a row was written.
   */
  async record(payload: AuditRecordPayload): Promise<boolean> {
    try {
      await this.prisma.auditLog.create({
        data: {
          eventId: payload.eventId,
          occurredAt: new Date(payload.occurredAt),
          service: payload.service,
          actorType: payload.actor.type,
          actorUserId: payload.actor.userId ?? null,
          actorDeviceId: payload.actor.deviceId ?? null,
          action: payload.action,
          resourceType: payload.resource.type,
          resourceId: payload.resource.id ?? null,
          // Validated JSON from the allowlisted schema; zod's `unknown` values are JSON by construction.
          metadata: payload.metadata as Prisma.InputJsonObject,
          ip: payload.ip ?? null,
          userAgent: payload.userAgent ?? null,
        },
        select: { id: true },
      });
      return true;
    } catch (error) {
      if (isUniqueConstraintViolation(error)) return false; // already applied
      throw error; // transient: the runner naks and retries
    }
  }
}
