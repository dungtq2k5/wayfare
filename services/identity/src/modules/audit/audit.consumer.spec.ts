import { Logger } from '@nestjs/common';
import { AuditAction, AuditActorType, AuditResourceType, newId } from '@wayfare/contracts';
import type { AuditRecordPayload } from '@wayfare/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuditConsumer } from './audit.consumer';
import type { AuditService } from './audit.service';

const payload = (action: AuditAction): AuditRecordPayload => {
  const userId = newId();
  return {
    eventId: newId(),
    occurredAt: new Date().toISOString(),
    service: 'identity',
    actor: { type: AuditActorType.USER, userId },
    action,
    resource: { type: AuditResourceType.USER, id: userId },
    metadata: {},
  };
};

function consumer(written: boolean) {
  const audit = { record: vi.fn().mockResolvedValue(written) };
  return new AuditConsumer(audit as unknown as AuditService);
}

afterEach(() => vi.restoreAllMocks());

describe('AuditConsumer alerts', () => {
  it.each([AuditAction.REFRESH_TOKEN_REPLAY_DETECTED, AuditAction.EMAIL_CHANGE_REVERTED])(
    '%s logs an alerting error',
    async (action) => {
      const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const event = payload(action);
      await consumer(true).handle(event);
      expect(error).toHaveBeenCalledWith(
        { alert: true, action, resourceId: event.resource.id },
        'Security alert',
      );
    },
  );

  it('a non-alert action, or a redelivered alert, logs nothing extra', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await consumer(true).handle(payload(AuditAction.USER_LOGIN));
    await consumer(false).handle(payload(AuditAction.EMAIL_CHANGE_REVERTED));
    expect(error).not.toHaveBeenCalled();
  });
});
