import { NotificationType } from '@wayfare/contracts';
import {
  Bell,
  CircleCheck,
  CircleX,
  CreditCard,
  EyeOff,
  Pencil,
  ShieldAlert,
  Ticket,
  TriangleAlert,
  UserCheck,
  UserX,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const ICONS: Partial<Record<NotificationType, LucideIcon>> = {
  [NotificationType.OWNER_REGISTRATION_APPROVED]: UserCheck,
  [NotificationType.OWNER_REGISTRATION_REJECTED]: UserX,
  [NotificationType.SUBMISSION_APPROVED]: CircleCheck,
  [NotificationType.SUBMISSION_REJECTED]: CircleX,
  [NotificationType.PLACE_ACTIVATED]: CircleCheck,
  [NotificationType.PLACE_UNPUBLISHED]: EyeOff,
  [NotificationType.PLACE_EDITED_BY_ADMIN]: Pencil,
  [NotificationType.PLACE_NARRATION_FAILED]: TriangleAlert,
  [NotificationType.SUBSCRIPTION_ACTIVATED]: CreditCard,
  [NotificationType.SUBSCRIPTION_PAYMENT_FAILED]: CreditCard,
  [NotificationType.ENTITLEMENTS_REDUCED]: CreditCard,
  [NotificationType.PAYOUT_ACCOUNT_ACTION_REQUIRED]: CreditCard,
  [NotificationType.VOUCHER_OFFER_APPROVED]: Ticket,
  [NotificationType.VOUCHER_OFFER_REJECTED]: Ticket,
  [NotificationType.VOUCHER_SOLD]: Ticket,
  [NotificationType.VOUCHER_CODE_GUESSING_SUSPECTED]: ShieldAlert,
  [NotificationType.ACCOUNT_RECOVERY_PENDING]: ShieldAlert,
  [NotificationType.ACCOUNT_RECOVERY_COMPLETED]: ShieldAlert,
};

/** A notification's type icon (the *Notification item*'s `Icon`); the bell for a type it doesn't know. */
export const notificationIcon = (type: string): LucideIcon =>
  ICONS[type as NotificationType] ?? Bell;
