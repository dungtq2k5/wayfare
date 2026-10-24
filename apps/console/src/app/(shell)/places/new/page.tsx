import { PlaceForm } from '../../../../content/place-form';
import { denial } from '../../../../server/guard';

/** A new Editorial Place (L4). */
export default async function NewPlacePage() {
  return (await denial('/places', 'place.create')) ?? <PlaceForm place={null} />;
}
