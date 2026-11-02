import { ownerSubmissionsGet } from '@wayfare/api-client';
import type { PlaceSubmissionPayload } from '@wayfare/contracts';
import { PlaceForm } from '../../../../../content/place-form';
import { serverCall } from '../../../../../server/api';
import { denial } from '../../../../../server/guard';

/** Add a venue (F1, F3–F6): an owner's `CREATE`; `?from=` proposes a sent one again (Q2b). */
export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const denied = await denial('/owner/venues');
  if (denied !== null) return denied;
  const { from } = await searchParams;
  const again =
    from === undefined
      ? undefined
      : await serverCall((options) => ownerSubmissionsGet(from, options)).then(
          ({ data }) => data.payload as PlaceSubmissionPayload,
          () => undefined,
        );
  return <PlaceForm place={null} audience="owner" {...(again === undefined ? {} : { again })} />;
}
