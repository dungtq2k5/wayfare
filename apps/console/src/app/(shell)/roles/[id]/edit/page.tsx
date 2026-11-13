import { roleDenial } from '../../../../../operations/role-route';
import { RoleForm } from '../../../../../operations/roles';

/** A role's edit (O3). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return (await roleDenial('role.update')) ?? <RoleForm id={(await params).id} />;
}
