/** A current `SUPER_ADMIN` holder, as the last-admin check sees it. */
export interface SuperAdminHolder {
  readonly userId: string;
  /** Not deactivated and not currently locked (rdm-spec I-4). */
  readonly active: boolean;
}

/** A change that may take a holder out of the active set: losing the role, a lock, a deactivation. */
export interface SuperAdminChange {
  readonly kind: 'REMOVE_ROLE' | 'LOCK' | 'DEACTIVATE';
  readonly userId: string;
}

/** The advisory-lock key every last-admin check serializes on. */
export const SUPER_ADMIN_LOCK_KEY = 'identity:super-admins';

/**
 * True when at least one active `SUPER_ADMIN` remains after the change (api-endpoints-plan §1.6).
 * A change to someone who is not an active holder removes nobody from the active set, so it
 * always passes.
 */
export function leavesActiveSuperAdmin(
  holders: readonly SuperAdminHolder[],
  change: SuperAdminChange,
): boolean {
  const target = holders.find((holder) => holder.userId === change.userId);
  if (!target?.active) return true;
  return holders.some((holder) => holder.active && holder.userId !== change.userId);
}
