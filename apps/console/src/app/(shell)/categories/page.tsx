import { Categories } from '../../../operations/categories';
import { denial } from '../../../server/guard';

/** Categories (G1). */
export default async function CategoriesPage() {
  return (await denial('/categories')) ?? <Categories />;
}
