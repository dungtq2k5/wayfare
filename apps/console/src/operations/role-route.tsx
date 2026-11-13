import type { ReactElement } from 'react';
import { currentUser } from '../server/api';
import { NoPermission } from '../states/states';

/**
 * The roles' own check (K21): they sit under *Users and roles* in the navigation but need
 * `role.read`, and a form its own permission; C14 otherwise.
 */
export async function roleDenial(needs?: string): Promise<ReactElement | null> {
  const { permissions } = await currentUser();
  const allowed =
    permissions.includes('role.read') && (needs === undefined || permissions.includes(needs));
  return allowed ? null : <NoPermission page="roles.title" />;
}
