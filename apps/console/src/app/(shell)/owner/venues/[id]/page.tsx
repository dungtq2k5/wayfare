import { ApiError, ownerPlacesGet } from '@wayfare/api-client';
import { OwnerVenuePage } from '../../../../../owner/venue-page';
import { serverCall } from '../../../../../server/api';
import { denial } from '../../../../../server/guard';
import { NotFoundView } from '../../../../../states/states';

/** A venue (M2–M4b), read on the server; another owner's is not found. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const denied = await denial('/owner/venues');
  if (denied !== null) return denied;
  const { id } = await params;
  try {
    const { data } = await serverCall((options) => ownerPlacesGet(id, options));
    return <OwnerVenuePage initial={data} />;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.code === 'VALIDATION_FAILED')) {
      return (
        <NotFoundView
          resource={{ name: 'venuePage.notFound', list: 'venues.title', href: '/owner/venues' }}
        />
      );
    }
    throw error;
  }
}
