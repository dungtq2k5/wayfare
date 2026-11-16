import type { ReactElement } from 'react';
import { mayOpen, navItemFor } from '../nav';
import { NoPermission } from '../states/states';
import { currentUser } from './api';

/**
 * A route's own permission check (K5), on the server: C14 when the section's read permission is
 * missing — never a page with data missing — else `null` and the page renders. `needs` is the
 * action's own permission, for a route that does something (a form).
 */
export async function denial(href: string, needs?: string): Promise<ReactElement | null> {
  const item = navItemFor(href);
  if (item === undefined) return null;
  const me = await currentUser();
  const allowed =
    mayOpen(item, me.permissions) && (needs === undefined || me.permissions.includes(needs));
  return allowed ? null : <NoPermission page={item.label} />;
}
