import { Suspense } from 'react';
import { OwnerStatsView } from '../../../../owner/stats';
import { denial } from '../../../../server/guard';

/** My stats (AO1–AO5): read in the browser, for the range its address holds. */
export default async function Page() {
  const denied = await denial('/owner/stats');
  if (denied !== null) return denied;
  return (
    <Suspense>
      <OwnerStatsView />
    </Suspense>
  );
}
