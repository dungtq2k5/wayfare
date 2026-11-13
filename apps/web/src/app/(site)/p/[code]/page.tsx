import { openingState } from '@wayfare/core';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { FavouriteToggle } from '../../../../favourites/favourite-toggle';
import { languageName } from '../../../../i18n/language-name';
import { requestLanguage, serverTranslator } from '../../../../i18n/server';
import { PlayStory, VoiceOffer } from '../../../../player/play-story';
import { AppBanner } from '../../../../places/app-banner';
import { categoryIcon } from '../../../../places/category-icon';
import { printedCode } from '../../../../places/format';
import { PhotoGallery } from '../../../../places/gallery';
import { isAndroid } from '../../../../places/intent';
import { loadPlace } from '../../../../places/load';
import { isTourCode } from '../../../../tours/load';
import { MenuSection } from '../../../../places/menu-section';
import type { MenuRow } from '../../../../places/menu-section';
import { MiniMap } from '../../../../places/mini-map';
import { OpenedPlaceRecorder } from '../../../../places/opened';
import { QrArrivalNote } from '../../../../analytics/qr-arrival-note';
import { OpeningBadge, OpeningHours, openingLabel } from '../../../../places/opening-hours';
import { PlaceGone } from '../../../../places/place-gone';
import { QuickActions } from '../../../../places/quick-actions';
import type { Track } from '../../../../player/track';
import { QrCode, Wallet } from 'lucide-react';

type Params = { params: Promise<{ code: string }> };
type PageProps = Params & { searchParams: Promise<{ via?: string | string[] }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { code } = await params;
  const { lang } = await requestLanguage();
  const lookup = await loadPlace(code, lang);
  if (lookup.kind !== 'place') return {};
  const { place } = lookup;
  const photo = place.photos[0]?.card.url;
  return {
    title: place.localization.name,
    description: place.localization.description.slice(0, 160),
    openGraph: {
      title: place.localization.name,
      description: place.localization.description.slice(0, 160),
      ...(photo === undefined ? {} : { images: [{ url: photo }] }),
    },
  };
}

/**
 * A Place from its sticker or a link (WQ1–WQ4): rendered on the server with no device, so the name,
 * the photo and *Play the story* arrive in the first response (K3).
 */
export default async function PlacePage({ params, searchParams }: PageProps) {
  const { code } = await params;
  const { via } = await searchParams;
  const { lang } = await requestLanguage();
  const translator = await serverTranslator();
  const { t, tDynamic } = translator;
  const lookup = await loadPlace(code, lang);
  if (lookup.kind === 'missing') {
    // One code space: a tour's code reached `/p/` (a sticker scanned while catalog was down).
    // A sticker's `?via=qr` goes along: the tour page counts the scan and drops it.
    if (await isTourCode(code))
      redirect(`/t/${encodeURIComponent(code)}${via === 'qr' ? '?via=qr' : ''}`);
    notFound();
  }
  if (lookup.kind === 'gone') return <PlaceGone area={lookup.area} near={lookup.near} />;

  const { place, vi, area } = lookup;
  const incoming = await headers();
  const host = incoming.get('host') ?? 'wayfare.app';
  const loc = place.localization;
  const now = Date.now();
  const opening = openingState(place.openingHours, now);
  const badge = openingLabel(opening, t, lang);
  const Category = categoryIcon(place.categoryCode);
  const areaName = area === null ? null : tDynamic(`area.${area.code}`);
  const meta = [tDynamic(`category.${place.categoryCode}`), areaName].filter(Boolean).join(' · ');
  const nameVi = vi !== null && vi.localization.name !== loc.name ? vi.localization.name : null;
  const pageLanguage = languageName(lang, lang);
  // WQ3: the text isn't in the page's language; one line says what it is in and why.
  const englishFallback = loc.contentTier === 'ENGLISH' && lang !== 'en';
  const note =
    loc.contentTier === 'REQUESTED' || loc.lang === lang
      ? null
      : englishFallback
        ? t('place.preparingLanguage', { language: pageLanguage })
        : place.kind === 'VENUE'
          ? t('place.shownAs', { language: languageName(loc.lang, lang), page: pageLanguage })
          : t('place.shownAsSource', {
              language: languageName(loc.lang, lang),
              page: pageLanguage,
            });
  const track: Track = {
    placeId: place.id,
    code: place.publicCode,
    name: loc.name,
    categoryCode: place.categoryCode,
    areaCode: area?.code ?? null,
    photoUrl: place.photos[0]?.card.url ?? null,
    lang: loc.lang,
    text: loc.description,
    audio: loc.audio === null ? null : { url: loc.audio.url, durationMs: loc.audio.durationMs },
  };
  const viDishes = new Map((vi?.menu?.items ?? []).map((item) => [item.id, item.name]));
  const menuRows: MenuRow[] = (place.menu?.items ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    nameVi: viDishes.get(item.id) === item.name ? null : (viDishes.get(item.id) ?? null),
    priceMinor: item.priceMinor,
    isAvailable: item.isAvailable,
    fallback:
      item.contentTier === 'REQUESTED' || lang === 'vi'
        ? null
        : item.contentTier === 'SOURCE'
          ? 'vi'
          : lang === 'en'
            ? null
            : 'en',
  }));
  const photos = place.photos.map((photo) => ({
    id: photo.id,
    url: photo.full.url,
    alt: photo.altText ?? '',
  }));

  const hours =
    place.openingHours.length === 0 ? null : (
      <section aria-labelledby="hours-heading" className="flex flex-col gap-4">
        <h2 id="hours-heading" className="text-lg font-semibold text-foreground">
          {t('place.hours')}
        </h2>
        <OpeningHours rows={place.openingHours} now={now} t={t} locale={lang} />
      </section>
    );
  const where = (
    <section aria-labelledby="where-heading" className="flex flex-col gap-4">
      <h2 id="where-heading" className="text-lg font-semibold text-foreground">
        {t('place.where')}
      </h2>
      {place.address === null ? null : (
        <p lang="vi" className="text-base text-foreground">
          {place.address}
        </p>
      )}
      <MiniMap
        area={area}
        location={place.location}
        categoryCode={place.categoryCode}
        name={loc.name}
        label={t('place.mapLabel', { name: loc.name })}
      />
      {area === null || areaName === null ? null : (
        <Link
          href={`/map/${area.code}?place=${place.publicCode}`}
          className="self-start rounded-sm text-base text-primary underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('place.seeOnMap', { area: areaName })}
        </Link>
      )}
      <QuickActions
        location={place.location}
        name={loc.name}
        phone={place.phone}
        website={place.websiteUrl}
        t={t}
      />
      <p className="flex items-center gap-2 text-sm">
        <QrCode aria-hidden className="size-5 text-muted-foreground" />
        <span className="text-muted-foreground">{t('place.code')}</span>
        <span className="font-mono font-medium text-foreground">
          {printedCode(place.publicCode)}
        </span>
      </p>
    </section>
  );

  return (
    <>
      <Suspense>
        <QrArrivalNote target="PLACE" />
      </Suspense>
      <OpenedPlaceRecorder
        place={{
          code: place.publicCode,
          placeId: place.id,
          name: loc.name,
          categoryCode: place.categoryCode,
          areaCode: area?.code ?? '',
          photoUrl: place.photos[0]?.card.url ?? null,
        }}
      />
      {isAndroid(incoming.get('user-agent')) ? (
        <AppBanner code={place.publicCode} host={host} t={t} />
      ) : null}
      {/*
        One column on a phone — the story, hours, menu, then where it is — and from 1200 px the
        story's column beside a card of the hours and where it is: each part rendered once, placed by
        the grid (the card is `contents` on a phone, so its parts take their order in the column).
      */}
      <div className="mx-auto flex w-full flex-col desk:place-columns desk:grid desk:max-w-300 desk:justify-center desk:gap-x-8 desk:gap-y-5 desk:px-6 desk:py-8">
        <div className="order-1 flex min-w-0 flex-col desk:col-start-1 desk:row-start-1 desk:gap-5">
          {areaName === null ? null : (
            <nav
              aria-label={t('place.breadcrumb')}
              className="hidden text-sm text-muted-foreground desk:block"
            >
              {areaName} › {tDynamic(`category.${place.categoryCode}`)}
            </nav>
          )}
          <PhotoGallery photos={photos} name={loc.name} categoryCode={place.categoryCode} />
          <div className="flex flex-col gap-4 px-4 pt-5 desk:p-0">
            <div className="flex flex-col gap-1">
              <div className="flex items-start gap-2">
                <h1 className="min-w-0 flex-1 text-2xl font-semibold text-foreground">
                  {loc.name}
                </h1>
                <FavouriteToggle placeId={place.id} />
              </div>
              {nameVi === null ? null : (
                <p lang="vi" className="text-sm text-muted-foreground">
                  {nameVi}
                </p>
              )}
              <p className="flex items-center gap-1 text-sm text-muted-foreground">
                <Category aria-hidden className="size-4" />
                {meta}
              </p>
            </div>
            {badge === null && place.priceBand === null ? null : (
              <div className="flex flex-wrap gap-2">
                {badge === null ? null : (
                  <OpeningBadge label={badge} open={opening.kind === 'open'} />
                )}
                {place.priceBand === null ? null : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-sm font-medium text-secondary-foreground">
                    <Wallet aria-hidden className="size-3" />
                    {t('place.priceRange', { band: place.priceBand })}
                  </span>
                )}
              </div>
            )}
            <PlayStory track={track} note={note} englishFallback={englishFallback} />
            <section aria-label={t('place.story')}>
              <p lang={loc.lang} className="text-base whitespace-pre-line text-foreground">
                {loc.description}
              </p>
            </section>
            {note === null ? null : <VoiceOffer track={track} />}
          </div>
        </div>
        {place.menu === null || menuRows.length === 0 ? null : (
          <div className="order-3 px-4 pt-4 desk:col-start-1 desk:row-start-2 desk:p-0">
            <MenuSection rows={menuRows} currency={place.menu.menuCurrency} />
          </div>
        )}
        <aside className="contents desk:col-start-2 desk:row-span-2 desk:row-start-1 desk:flex desk:h-fit desk:flex-col desk:gap-4 desk:rounded-lg desk:border desk:border-border desk:bg-card desk:p-5">
          {hours === null ? null : <div className="order-2 px-4 pt-4 desk:p-0">{hours}</div>}
          <div className="order-4 px-4 pt-4 pb-5 desk:p-0">{where}</div>
        </aside>
      </div>
    </>
  );
}
