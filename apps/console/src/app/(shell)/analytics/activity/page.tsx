import { Suspense } from 'react';
import { ActivityView } from '../../../../analytics/activity';
import { denial } from '../../../../server/guard';

/** Analytics → Activity (AD4): `analytics.read` only; read in the browser. */
export default async function Page() {
  const denied = await denial('/analytics');
  if (denied !== null) return denied;
  return (
    <Suspense>
      <ActivityView />
    </Suspense>
  );
}
