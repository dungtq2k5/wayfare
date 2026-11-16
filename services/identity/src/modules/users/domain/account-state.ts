/** The account columns that decide whether an account can act (rdm-spec I-1). */
export interface AccountStateColumns {
  readonly deletedAt: Date | null;
  readonly isLocked: boolean;
  readonly lockedUntil: Date | null;
}

/** True while a lock holds: indefinite, or not yet lapsed. */
export function isLockActive(
  user: Pick<AccountStateColumns, 'isLocked' | 'lockedUntil'>,
  now: Date,
): boolean {
  return user.isLocked && (user.lockedUntil === null || user.lockedUntil.getTime() > now.getTime());
}

/** Active: not deactivated and not currently locked — the last-`SUPER_ADMIN` rule's meaning. */
export function isActiveAccount(user: AccountStateColumns, now: Date): boolean {
  return user.deletedAt === null && !isLockActive(user, now);
}

/**
 * The address an erased account keeps (rdm-spec I-1): unique by the id, never deliverable, and
 * freeing the real address by construction.
 */
export function erasedEmail(userId: string): string {
  return `erased+${userId.toLowerCase()}@invalid.wayfare.app`;
}
