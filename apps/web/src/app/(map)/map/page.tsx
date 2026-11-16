import { redirect } from 'next/navigation';
import { loadAreasOrThrow } from '../../../places/load';

/** `/map`: the first area (District 1 centre), or the area chooser's state with none. */
export default async function MapIndex({
  searchParams,
}: {
  searchParams: Promise<{ place?: string }>;
}): Promise<never> {
  const areas = await loadAreasOrThrow();
  const { place } = await searchParams;
  const first = areas[0]?.code ?? 'hcmc-d1-core';
  redirect(`/map/${first}${place === undefined ? '' : `?place=${encodeURIComponent(place)}`}`);
}
