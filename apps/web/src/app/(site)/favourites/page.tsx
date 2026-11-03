import type { Metadata } from 'next';
import { FavouritesView } from '../../../favourites/favourites-view';
import { serverTranslator } from '../../../i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await serverTranslator()).t('fav.title') };
}

/** Saved places (WA3): read in the browser, with its device. */
export default function FavouritesPage() {
  return <FavouritesView />;
}
