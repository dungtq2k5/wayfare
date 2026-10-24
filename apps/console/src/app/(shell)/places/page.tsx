import { PlacesList } from '../../../content/places-list';
import { denial } from '../../../server/guard';

/** The Places list (L1, L8c). */
export default async function PlacesPage() {
  return (await denial('/places')) ?? <PlacesList />;
}
