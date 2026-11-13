import { roleDenial } from '../../../../operations/role-route';
import { RolePage } from '../../../../operations/roles';

/** A role (O2). Roles are few: the page picks its row from the list. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return (await roleDenial()) ?? <RolePage id={(await params).id} />;
}
