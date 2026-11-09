import { Suspense } from 'react';
import { HeatmapView } from '../../../../analytics/heatmap';
import { denial } from '../../../../server/guard';

/** Analytics → Heatmap (AD3): `analytics.read` only; read in the browser. */
export default async function Page() {
  const denied = await denial('/analytics');
  if (denied !== null) return denied;
  return (
    <Suspense>
      <HeatmapView />
    </Suspense>
  );
}
