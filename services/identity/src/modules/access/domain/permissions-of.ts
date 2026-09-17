import { compareStrings } from '@wayfare/contracts';

/** A role as the permission read loads it. */
export interface RoleGrants {
  readonly code: string;
  readonly permissions: readonly { readonly code: string; readonly isRetired: boolean }[];
}

/**
 * The permission set a token carries: the union of every role's live grants, sorted and
 * de-duplicated. A retired code grants nothing, even while a custom role still holds it.
 */
export function permissionsOf(roles: readonly RoleGrants[]): string[] {
  const codes = new Set<string>();
  for (const role of roles) {
    for (const permission of role.permissions) {
      if (!permission.isRetired) codes.add(permission.code);
    }
  }
  return [...codes].toSorted(compareStrings);
}

/** The role codes, sorted. */
export function roleCodesOf(roles: readonly RoleGrants[]): string[] {
  return roles.map((role) => role.code).toSorted(compareStrings);
}
