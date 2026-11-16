import { AccountKind, SystemRole } from '@wayfare/contracts';

// Widened: role codes are read from the database as plain strings.
const NOT_STAFF: readonly string[] = [SystemRole.USER, SystemRole.VENUE_OWNER];
const OWNER_CODE: string = SystemRole.VENUE_OWNER;

/**
 * What an account is, from its role codes (rdm-spec I-1): staff if it holds any role but `USER`
 * and `VENUE_OWNER` — a custom role included — else an owner if it holds `VENUE_OWNER`, else a
 * tourist. An owner who also holds a staff role is staff.
 */
export function kindOf(roleCodes: readonly string[]): AccountKind {
  if (roleCodes.some((code) => !NOT_STAFF.includes(code))) return AccountKind.STAFF;
  if (roleCodes.includes(OWNER_CODE)) return AccountKind.OWNER;
  return AccountKind.TOURIST;
}
