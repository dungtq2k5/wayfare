import { ApiError, adminPronunciationsGet } from '@wayfare/api-client';
import { PronunciationForm } from '../../../../../operations/pronunciation-form';
import { serverCall } from '../../../../../server/api';
import { denial } from '../../../../../server/guard';
import { NotFoundView } from '../../../../../states/states';

/** A pronunciation entry, frame D2, read on the server. */
export default async function EntryPage({ params }: { params: Promise<{ id: string }> }) {
  const denied = await denial('/narration/pronunciation');
  if (denied !== null) return denied;
  const { id } = await params;
  try {
    const { data } = await serverCall((options) => adminPronunciationsGet(id, options));
    return <PronunciationForm entry={data.entry} />;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.code === 'VALIDATION_FAILED')) {
      return (
        <NotFoundView
          resource={{
            name: 'resource.entry',
            list: 'nav.pronunciation',
            href: '/narration/pronunciation',
          }}
        />
      );
    }
    throw error;
  }
}
