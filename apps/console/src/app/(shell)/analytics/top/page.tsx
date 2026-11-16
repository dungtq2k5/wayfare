import { Suspense } from 'react';
import { TopPlacesView } from '../../../../analytics/top-places';
import { denial } from '../../../../server/guard';

/** Analytics → Top Places (AD2): `analytics.read` only; read in the browser. */
export default async function Page() {
  const denied = await denial('/analytics');
  if (denied !== null) return denied;
  return (
    <Suspense>
      <TopPlacesView />
    </Suspense>
  );
}
