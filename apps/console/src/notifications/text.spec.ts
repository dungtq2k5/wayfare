import { NotificationType } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { createTranslator } from '../i18n/messages';
import { notificationTarget, notificationText, relativeTime } from './text';

const en = createTranslator('en');
const vi = createTranslator('vi');
const PLACE = '0190a0b0-0000-7000-8000-000000000001';
const context = { placeName: (id: string) => (id === PLACE ? 'Phở Hòa Pasteur' : undefined) };

describe('the notification text (K10)', () => {
  it('renders each type with its data as the handoff’s line', () => {
    for (const type of Object.values(NotificationType)) {
      const line = notificationText(
        { type, data: { placeId: PLACE, planCode: 'GROWTH' } },
        context,
        en,
      );
      expect(line, type).not.toBe(en.t('error.generic'));
      expect(line, type).not.toMatch(/[{}]/);
    }
    expect(
      notificationText({ type: 'PLACE_ACTIVATED', data: { placeId: PLACE } }, context, en),
    ).toBe('Phở Hòa Pasteur is live for tourists.');
    expect(
      notificationText(
        { type: 'SUBSCRIPTION_ACTIVATED', data: { planCode: 'GROWTH' } },
        context,
        vi,
      ),
    ).toBe('Gói Growth của bạn đã được kích hoạt.');
  });

  it('falls back to "your venue" for a Place the reader has not loaded', () => {
    expect(
      notificationText(
        { type: 'SUBMISSION_APPROVED', data: { placeId: '0190a0b0-0000-7000-8000-000000000009' } },
        context,
        en,
      ),
    ).toBe('Your changes to your venue were approved.');
  });

  it('opens what it is about', () => {
    expect(notificationTarget({ type: 'PLACE_ACTIVATED', data: { placeId: PLACE } })).toBe(
      `/owner/venues/${PLACE}`,
    );
    expect(notificationTarget({ type: 'SUBSCRIPTION_PAYMENT_FAILED', data: {} })).toBe(
      '/owner/billing',
    );
    expect(notificationTarget({ type: 'ACCOUNT_RECOVERY_PENDING', data: {} })).toBe('/account');
  });

  it('says when, relatively', () => {
    const now = new Date('2026-10-23T12:00:00Z');
    expect(relativeTime('2026-10-23T11:59:40Z', now, en)).toBe('Just now');
    expect(relativeTime('2026-10-23T11:55:00Z', now, en)).toBe('5 minutes ago');
    expect(relativeTime('2026-10-23T09:00:00Z', now, en)).toBe('3 hours ago');
    expect(relativeTime('2026-10-22T09:00:00Z', now, en)).toBe('Yesterday');
    expect(relativeTime('2026-10-19T09:00:00Z', now, vi)).toBe('4 ngày trước');
  });
});
