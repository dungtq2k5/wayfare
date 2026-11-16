import { ApiError, ownerSubmissionsGet } from '@wayfare/api-client';
import { OwnerSubmissionPage } from '../../../../../owner/submission-page';
import { serverCall } from '../../../../../server/api';
import { denial } from '../../../../../server/guard';
import { NotFoundView } from '../../../../../states/states';

/** A submission (Q2, Q2b), read on the server; another owner's is not found. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const denied = await denial('/owner/submissions');
  if (denied !== null) return denied;
  const { id } = await params;
  try {
    const { data } = await serverCall((options) => ownerSubmissionsGet(id, options));
    return <OwnerSubmissionPage initial={data} />;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.code === 'VALIDATION_FAILED')) {
      return (
        <NotFoundView
          resource={{ name: 'mySub.notFound', list: 'mySubs.title', href: '/owner/submissions' }}
        />
      );
    }
    throw error;
  }
}
