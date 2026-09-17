import { describe, expect, it } from 'vitest';
import { compareStrings } from '../common/sorting';
import { newId } from '../common/ids';
import { advanceDeliveryStatus } from './email-delivery';
import {
  EMAIL_SECURITY_TEMPLATES,
  EMAIL_TEMPLATE_DATA,
  EMAIL_TEMPLATE_LINKS,
} from './email-templates';
import { NOTIFICATION_DATA, zNotification } from './data';
import {
  EMAIL_DELIVERY_STATUSES,
  EMAIL_TEMPLATES,
  EmailDeliveryStatus,
  EmailTemplate,
  NOTIFICATION_TYPES,
  NotificationType,
} from './types';

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
        expiresAt: '2026-09-23T00:00:00.000Z',
      }).success,
    ).toBe(true);
    const notice = EMAIL_TEMPLATE_DATA[EmailTemplate.ACCOUNT_RECOVERY_NOTICE];
    expect(notice.safeParse({ recoveryId: newId(), stage: 'LINK_SENT' }).success).toBe(true);
    expect(notice.safeParse({ recoveryId: newId(), stage: 'PENDING' }).success).toBe(false);
  });
});

describe('email templates carry no token', () => {
  it.each(EMAIL_TEMPLATES)('%s has no token field and names its link slots', (template) => {
    const schema = EMAIL_TEMPLATE_DATA[template] as unknown as { shape: Record<string, unknown> };
    for (const field of Object.keys(schema.shape)) expect(field).not.toMatch(/^token$|Token$/);
    expect(EMAIL_TEMPLATE_LINKS[template]).toBeDefined();
  });

  it('refuses a token smuggled into template data', () => {
    expect(
      EMAIL_TEMPLATE_DATA[EmailTemplate.PASSWORD_RESET].safeParse({ token: 'x' }).success,
    ).toBe(false);
  });

  it('never lets a bounce suppress the account-security templates', () => {
    expect(EMAIL_SECURITY_TEMPLATES.has(EmailTemplate.ACCOUNT_SETUP)).toBe(true);
    expect(EMAIL_SECURITY_TEMPLATES.has(EmailTemplate.PAYMENT_FAILED)).toBe(false);
  });
});

describe('advanceDeliveryStatus', () => {
  const S = EmailDeliveryStatus;
  it.each([
    [S.QUEUED, S.SENT, S.SENT],
    [S.SENT, S.DELIVERED, S.DELIVERED],
    [S.DELIVERED, S.COMPLAINED, S.COMPLAINED],
    [S.DELIVERED, S.SENT, null],
    [S.SENT, S.SENT, null],
    [S.DELIVERED, S.BOUNCED, S.BOUNCED],
    [S.COMPLAINED, S.FAILED, S.FAILED],
    [S.BOUNCED, S.DELIVERED, null],
    [S.BOUNCED, S.FAILED, null],
    [S.FAILED, S.SENT, null],
  ])('%s → %s gives %s', (current, next, expected) => {
    expect(advanceDeliveryStatus(current, next)).toBe(expected);
  });

  it('covers every pair without throwing', () => {
    for (const current of EMAIL_DELIVERY_STATUSES)
      for (const next of EMAIL_DELIVERY_STATUSES) advanceDeliveryStatus(current, next);
  });
});
