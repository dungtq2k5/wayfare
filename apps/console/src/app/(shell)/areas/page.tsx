import { AreasList } from '../../../operations/areas';
import { denial } from '../../../server/guard';

/** Areas and map packs (A1). */
export default async function AreasPage() {
  return (await denial('/areas')) ?? <AreasList />;
}
