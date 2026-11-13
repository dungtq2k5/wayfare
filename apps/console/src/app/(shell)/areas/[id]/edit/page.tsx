import { AreaForm } from '../../../../../operations/area-form';
import { areaOnServer } from '../../../../../operations/area-route';
import { denial } from '../../../../../server/guard';
import { NotFoundView } from '../../../../../states/states';

/** An area's edit (A3b, A4, A4b), read on the server. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const denied = await denial('/areas', 'catalog.taxonomy.manage');
  if (denied !== null) return denied;
  const area = await areaOnServer((await params).id);
  return area === null ? (
    <NotFoundView resource={{ name: 'resource.area', list: 'nav.areas', href: '/areas' }} />
  ) : (
    <AreaForm area={area} />
  );
}
