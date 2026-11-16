import { ApiError, adminUsersGet } from '@wayfare/api-client';
import type { ReactElement } from 'react';
import { serverCall } from '../server/api';
import { denial } from '../server/guard';
import { NotFoundView } from '../states/states';
import type { UserView } from './user-page';

/**
 * A user read on the server with the caller's session, handed to `render`; C14 without
 * `user.read`, the not-found page for no account or an erased one (nothing is left to show).
 */
export async function withUser(
  params: Promise<{ id: string }>,
  render: (user: UserView) => ReactElement,
): Promise<ReactElement> {
  const denied = await denial('/users');
  if (denied !== null) return denied;
  const notFound = (
    <NotFoundView resource={{ name: 'resource.user', list: 'nav.users', href: '/users' }} />
  );
  try {
    const { data } = await serverCall(async (options) => adminUsersGet((await params).id, options));
    return data.erased ? notFound : render(data);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.code === 'VALIDATION_FAILED'))
      return notFound;
    throw error;
  }
}
