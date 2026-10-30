import { AreaForm } from '../../../../operations/area-form';
import { denial } from '../../../../server/guard';

/** A new area (A3). */
export default async function NewAreaPage() {
  return (await denial('/areas', 'catalog.taxonomy.manage')) ?? <AreaForm area={null} />;
}
