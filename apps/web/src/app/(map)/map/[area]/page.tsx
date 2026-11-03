import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { serverTranslator } from '../../../../i18n/server';
import { MapPage } from '../../../../map/map-page';
import { loadAreas } from '../../../../places/load';

type Props = {
  params: Promise<{ area: string }>;
  searchParams: Promise<{ place?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { area } = await params;
  const { t, tDynamic } = await serverTranslator();
  return { title: t('map.label', { area: tDynamic(`area.${area}`, undefined, area) }) };
}

/** An area's map (WM1): the areas from `/areas`, the rest in the browser with its device. */
export default async function AreaMapPage({ params, searchParams }: Props) {
  const { area: code } = await params;
  const { place } = await searchParams;
  const areas = await loadAreas();
  const area = areas.find((candidate) => candidate.code === code);
  if (area === undefined) notFound();
  const host = (await headers()).get('host')?.split(':')[0] ?? 'wayfare.app';
  return <MapPage areas={areas} area={area} placeCode={place ?? null} host={host} />;
}
