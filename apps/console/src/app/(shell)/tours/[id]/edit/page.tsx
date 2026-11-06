import { ApiError, adminToursGet } from '@wayfare/api-client';
import { TourForm } from '../../../../../content/tour-form';
import { serverCall } from '../../../../../server/api';
import { denial } from '../../../../../server/guard';
import { NotFoundView } from '../../../../../states/states';

/** Edit a tour (TA3b). */
export default async function EditTourPage({ params }: { params: Promise<{ id: string }> }) {
  const denied = await denial('/tours');
  if (denied !== null) return denied;
  const { id } = await params;
  try {
    const { data } = await serverCall((options) => adminToursGet(id, options));
    return <TourForm tour={data} />;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.code === 'VALIDATION_FAILED')) {
      return (
        <NotFoundView resource={{ name: 'resource.tour', list: 'nav.tours', href: '/tours' }} />
      );
    }
    throw error;
  }
}
