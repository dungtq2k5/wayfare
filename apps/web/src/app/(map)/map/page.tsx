import { redirect } from 'next/navigation';
import { loadAreas } from '../../../places/load';

/** `/map`: the first area (District 1 centre), or the area chooser's state with none. */
export default async function MapIndex({
  searchParams,
}: {
  searchParams: Promise<{ place?: string }>;
}): Promise<never> {
  const areas = await loadAreas();
  const { place } = await searchParams;
  const first = areas[0]?.code ?? 'hcmc-d1-core';
  redirect(`/map/${first}${place === undefined ? '' : `?place=${encodeURIComponent(place)}`}`);
}
