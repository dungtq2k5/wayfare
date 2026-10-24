import { ApiError, adminPlacesGet } from '@wayfare/api-client';
import { PlacePage } from '../../../../content/place-page';
import { denial } from '../../../../server/guard';
import { serverCall } from '../../../../server/api';
import { NotFoundView } from '../../../../states/states';

/** A Place's page (L2), its data read on the server with the caller's session (K3). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const denied = await denial('/places');
  if (denied !== null) return denied;
  const { id } = await params;
  try {
    const { data } = await serverCall((options) => adminPlacesGet(id, options));
    return <PlacePage initial={data} />;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.code === 'VALIDATION_FAILED')) {
      return (
        <NotFoundView resource={{ name: 'resource.place', list: 'nav.places', href: '/places' }} />
      );
    }
    throw error;
  }
}
