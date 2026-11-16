import { roleDenial } from '../../../../operations/role-route';
import { RoleForm } from '../../../../operations/roles';

/** A new role (O3). */
export default async function NewRolePage() {
  return (await roleDenial('role.create')) ?? <RoleForm id={null} />;
}
