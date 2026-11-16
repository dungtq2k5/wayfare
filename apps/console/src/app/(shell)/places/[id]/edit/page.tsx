import { ApiError, adminPlacesGet } from '@wayfare/api-client';
import { PlaceForm } from '../../../../../content/place-form';
import { denial } from '../../../../../server/guard';
import { serverCall } from '../../../../../server/api';
import { NotFoundView } from '../../../../../states/states';

/** A Place's edit form (L5). */
export default async function EditPlacePage({ params }: { params: Promise<{ id: string }> }) {
  const denied = await denial('/places', 'place.update');
  if (denied !== null) return denied;
  const { id } = await params;
  try {
    const { data } = await serverCall((options) => adminPlacesGet(id, options));
    return <PlaceForm place={data} />;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.code === 'VALIDATION_FAILED')) {
      return (
        <NotFoundView resource={{ name: 'resource.place', list: 'nav.places', href: '/places' }} />
      );
    }
    throw error;
  }
}
