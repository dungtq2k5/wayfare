import { ApiError, adminToursGet } from '@wayfare/api-client';
import { TourPage } from '../../../../content/tour-page';
import { serverCall } from '../../../../server/api';
import { denial } from '../../../../server/guard';
import { NotFoundView } from '../../../../states/states';

/** A tour's page (TA2), its data read on the server with the caller's session. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const denied = await denial('/tours');
  if (denied !== null) return denied;
  const { id } = await params;
  try {
    const { data } = await serverCall((options) => adminToursGet(id, options));
    return <TourPage initial={data} />;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.code === 'VALIDATION_FAILED')) {
      return (
        <NotFoundView resource={{ name: 'resource.tour', list: 'nav.tours', href: '/tours' }} />
      );
    }
    throw error;
  }
}
