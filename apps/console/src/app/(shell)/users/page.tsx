import { Users } from '../../../operations/users';
import { denial } from '../../../server/guard';

/** Users and roles (U1). */
export default async function UsersPage() {
  return (await denial('/users')) ?? <Users />;
}
