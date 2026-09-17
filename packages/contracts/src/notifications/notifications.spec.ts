import { describe, expect, it } from 'vitest';
import { compareStrings } from '../common/sorting';
import { newId } from '../common/ids';
import { EMAIL_TEMPLATE_DATA } from './email-templates';
import { NOTIFICATION_DATA, zNotification } from './data';
import { EMAIL_TEMPLATES, EmailTemplate, NOTIFICATION_TYPES, NotificationType } from './types';

describe('notification data', () => {
  it('has a schema for every type and every email template', () => {
    expect(Object.keys(NOTIFICATION_DATA).toSorted(compareStrings)).toEqual(
      [...NOTIFICATION_TYPES].toSorted(compareStrings),
    );
    expect(Object.keys(EMAIL_TEMPLATE_DATA).toSorted(compareStrings)).toEqual(
      [...EMAIL_TEMPLATES].toSorted(compareStrings),
    );
  });

  it('validates a notification against its own type', () => {
    const placeId = newId();
    expect(
      zNotification.safeParse({ type: NotificationType.PLACE_EDITED_BY_ADMIN, data: { placeId } })
        .success,
    ).toBe(true);
    expect(
      zNotification.safeParse({ type: NotificationType.VOUCHER_SOLD, data: { placeId } }).success,
    ).toBe(false);
  });

  it('never carries a sale amount to a notification', () => {
    const sold = { orderId: newId(), placeId: newId(), quantity: 2 };
    expect(NOTIFICATION_DATA.VOUCHER_SOLD.safeParse(sold).success).toBe(true);
    expect(NOTIFICATION_DATA.VOUCHER_SOLD.safeParse({ ...sold, amountMinor: 500 }).success).toBe(
      false,
    );
  });

  it('bounds a decision note', () => {
    const decision = { registrationId: newId() };
    const approved = NOTIFICATION_DATA.OWNER_REGISTRATION_APPROVED;
    expect(approved.safeParse({ ...decision, decisionNote: 'x'.repeat(1000) }).success).toBe(true);
    expect(approved.safeParse({ ...decision, decisionNote: 'x'.repeat(1001) }).success).toBe(false);
  });

  it('shapes the staff invite and recovery emails', () => {
    expect(
      EMAIL_TEMPLATE_DATA[EmailTemplate.STAFF_INVITE].safeParse({
        membershipId: newId(),
        sellerName: 'Cafe',
        inviteToken: 'tok',
        expiresAt: '2026-09-23T00:00:00.000Z',
      }).success,
    ).toBe(true);
    const notice = EMAIL_TEMPLATE_DATA[EmailTemplate.ACCOUNT_RECOVERY_NOTICE];
    expect(
      notice.safeParse({ recoveryId: newId(), stage: 'LINK_SENT', completionToken: 'tok' }).success,
    ).toBe(true);
    expect(notice.safeParse({ recoveryId: newId(), stage: 'PENDING' }).success).toBe(false);
  });
});
