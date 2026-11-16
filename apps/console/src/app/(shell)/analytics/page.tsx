import { Suspense } from 'react';
import { OverviewView } from '../../../analytics/overview';
import { denial } from '../../../server/guard';

/** Analytics → Overview (AD1, AD5): `analytics.read` only; read in the browser. */
export default async function Page() {
  const denied = await denial('/analytics');
  if (denied !== null) return denied;
  return (
    <Suspense>
      <OverviewView />
    </Suspense>
  );
}
