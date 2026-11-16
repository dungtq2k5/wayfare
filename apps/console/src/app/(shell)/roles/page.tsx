import { roleDenial } from '../../../operations/role-route';
import { Roles } from '../../../operations/roles';

/** Roles (O1). */
export default async function RolesPage() {
  return (await roleDenial()) ?? <Roles />;
}
