import { ownerPlacesList } from '@wayfare/api-client';
import { VenuesView } from '../../../../owner/venues';
import { serverCall } from '../../../../server/api';
import { denial } from '../../../../server/guard';

/** My venues (M1, M1b), read on the server with the caller's session. */
export default async function Page() {
  const denied = await denial('/owner/venues');
  if (denied !== null) return denied;
  const { data } = await serverCall((options) => ownerPlacesList(options));
  return <VenuesView initial={data} />;
}
