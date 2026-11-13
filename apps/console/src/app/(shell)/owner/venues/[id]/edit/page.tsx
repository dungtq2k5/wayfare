import { ApiError, ownerPlacesGet, ownerSubmissionsGet } from '@wayfare/api-client';
import type { PlaceSubmissionPayload } from '@wayfare/contracts';
import { PlaceForm } from '../../../../../../content/place-form';
import { serverCall } from '../../../../../../server/api';
import { denial } from '../../../../../../server/guard';
import { NotFoundView } from '../../../../../../states/states';

/**
 * Propose a change (F2, F6b): the venue as it is, with the hash it opened with; a change already
 * waiting is said; `?from=` starts from a sent submission (Q2b).
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const denied = await denial('/owner/venues');
  if (denied !== null) return denied;
  const [{ id }, { from }] = await Promise.all([params, searchParams]);
  try {
    const { data } = await serverCall((options) => ownerPlacesGet(id, options));
    const again =
      from === undefined
        ? undefined
        : await serverCall((options) => ownerSubmissionsGet(from, options)).then(
            ({ data: sent }) => sent.payload as PlaceSubmissionPayload,
            () => undefined,
          );
    return (
      <PlaceForm
        place={data.place}
        audience="owner"
        baseHash={data.editableHash}
        waiting={data.pendingSubmission}
        {...(again === undefined ? {} : { again })}
      />
    );
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
