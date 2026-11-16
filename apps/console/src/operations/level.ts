import { compareStrings } from '@wayfare/contracts';

/**
 * The codes an account holds that the viewer doesn't (K19): any one makes the account's page
 * read-only for the viewer, so no action is offered that the API's no-escalation rule refuses.
 */
export const lackedCodes = (viewer: readonly string[], target: readonly string[]): string[] => {
  const held = new Set(viewer);
  return [...new Set(target)].filter((code) => !held.has(code)).toSorted(compareStrings);
};

/** Whether the viewer may give a role (K20): every permission it grants is the viewer's own. */
export const mayGive = (viewer: readonly string[], role: { permissionCodes: readonly string[] }) =>
  lackedCodes(viewer, role.permissionCodes).length === 0;
