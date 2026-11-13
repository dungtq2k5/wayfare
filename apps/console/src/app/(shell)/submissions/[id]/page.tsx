import { ApiError, adminSubmissionsGet } from '@wayfare/api-client';
import { SubmissionPage } from '../../../../content/submission-page';
import { denial } from '../../../../server/guard';
import { serverCall } from '../../../../server/api';
import { NotFoundView } from '../../../../states/states';

/** A submission (S2–S6), read on the server with the caller's session. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const denied = await denial('/submissions');
  if (denied !== null) return denied;
  const { id } = await params;
  try {
    const { data } = await serverCall((options) => adminSubmissionsGet(id, options));
    return <SubmissionPage initial={data} />;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.code === 'VALIDATION_FAILED')) {
      return (
        <NotFoundView
          resource={{ name: 'resource.submission', list: 'nav.submissions', href: '/submissions' }}
        />
      );
    }
    throw error;
  }
}
