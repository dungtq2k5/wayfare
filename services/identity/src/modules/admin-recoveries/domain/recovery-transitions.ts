import { AccountRecoveryStatus } from '@wayfare/contracts';

/** The statuses in which a case is still going somewhere (rdm-spec I-14's one-live index). */
export const LIVE_RECOVERY_STATUSES = [
  AccountRecoveryStatus.PENDING_APPROVAL,
  AccountRecoveryStatus.ON_HOLD,
  AccountRecoveryStatus.LINK_SENT,
] as const;

/** Whether a case is still live. */
export function isLive(status: string): boolean {
  return (LIVE_RECOVERY_STATUSES as readonly string[]).includes(status);
}

/** What each action needs the case to be. A transition from anywhere else is `409`. */
export const ALLOWED_FROM = {
  approve: [AccountRecoveryStatus.PENDING_APPROVAL],
  reject: [AccountRecoveryStatus.PENDING_APPROVAL],
  /** An owner may stop it at any point before it is finished. */
  cancel: [
    AccountRecoveryStatus.PENDING_APPROVAL,
    AccountRecoveryStatus.ON_HOLD,
    AccountRecoveryStatus.LINK_SENT,
  ],
  /** Only a case whose link has gone out can be finished. */
  complete: [AccountRecoveryStatus.LINK_SENT],
  /** The job moves a held case on once its hold has passed. */
  advance: [AccountRecoveryStatus.ON_HOLD],
} as const satisfies Record<string, readonly AccountRecoveryStatus[]>;

/** Whether `status` allows `action`. */
export function allows(action: keyof typeof ALLOWED_FROM, status: string): boolean {
  return (ALLOWED_FROM[action] as readonly string[]).includes(status);
}

/** The statuses that end a case: its cancel token is cleared as it lands on one. */
export const TERMINAL_RECOVERY_STATUSES = [
  AccountRecoveryStatus.COMPLETED,
  AccountRecoveryStatus.CANCELLED,
  AccountRecoveryStatus.REJECTED,
  AccountRecoveryStatus.EXPIRED,
] as const;
