import { AreaPage } from '../../../../operations/areas';
import { areaOnServer } from '../../../../operations/area-route';
import { denial } from '../../../../server/guard';
import { NotFoundView } from '../../../../states/states';

/** An area's page (A2), read on the server; a pack manager reads it too, without its edits. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const denied = await denial('/areas');
  if (denied !== null) return denied;
  const area = await areaOnServer((await params).id);
  return area === null ? (
    <NotFoundView resource={{ name: 'resource.area', list: 'nav.areas', href: '/areas' }} />
  ) : (
    <AreaPage initial={area} />
  );
}
