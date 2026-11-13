import { ApiError, adminNarrationGet } from '@wayfare/api-client';
import { NarrationJob } from '../../../../../content/narration-job';
import { denial } from '../../../../../server/guard';
import { serverCall } from '../../../../../server/api';
import { NotFoundView } from '../../../../../states/states';

/** A narration job (J2, J3), read on the server with the caller's session. */
export default async function NarrationJobPage({ params }: { params: Promise<{ id: string }> }) {
  const denied = await denial('/narration/jobs');
  if (denied !== null) return denied;
  const { id } = await params;
  try {
    const { data } = await serverCall((options) => adminNarrationGet(id, options));
    return <NarrationJob initial={data} />;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.code === 'VALIDATION_FAILED')) {
      return (
        <NotFoundView
          resource={{ name: 'resource.job', list: 'nav.narrationJobs', href: '/narration/jobs' }}
        />
      );
    }
    throw error;
  }
}
