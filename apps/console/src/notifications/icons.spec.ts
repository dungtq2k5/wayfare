import { NotificationType } from '@wayfare/contracts';
import { Bell, CreditCard, UserCheck } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { notificationIcon } from './icons';

describe('a notification’s type icon', () => {
  it('draws each type by its icon, and one it doesn’t know with the bell', () => {
    expect(notificationIcon(NotificationType.OWNER_REGISTRATION_APPROVED)).toBe(UserCheck);
    expect(notificationIcon(NotificationType.SUBSCRIPTION_PAYMENT_FAILED)).toBe(CreditCard);
    expect(notificationIcon('NO_SUCH_TYPE')).toBe(Bell);
  });
});
