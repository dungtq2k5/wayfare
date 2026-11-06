import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Footprints, Info, ListOrdered, Route, Timer } from 'lucide-react';
import { languageName } from '../../../../i18n/language-name';
import { requestLanguage, serverTranslator } from '../../../../i18n/server';
import { distance } from '../../../../places/format';
import { loadTour } from '../../../../tours/load';
import { TourGone } from '../../../../tours/tour-gone';
import { TourStops } from '../../../../tours/tour-stops';

type Params = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { code } = await params;
  const { lang } = await requestLanguage();
  const lookup = await loadTour(code, lang);
  if (lookup.kind !== 'tour') return {};
  const { tour } = lookup;
  const description = tour.text.description.slice(0, 160);
  return {
    title: tour.text.title,
    description,
    openGraph: {
      title: tour.text.title,
      description,
      ...(tour.cover === null ? {} : { images: [{ url: tour.cover.url }] }),
    },
  };
}

/**
 * A tour from its link or sticker (TW2, TW2b, TW3): rendered on the server with no device — the
 * cover, the title, the honest line and the stops arrive in the first response; each stop is
 * played by hand, and the progress is this browser's.
 */
export default async function TourPage({ params }: Params) {
  const { code } = await params;
  const { lang } = await requestLanguage();
  const { t, tDynamic } = await serverTranslator();
  const lookup = await loadTour(code, lang);
  if (lookup.kind === 'missing') notFound();
  if (lookup.kind === 'gone') return <TourGone area={lookup.area} />;

  const { tour, area } = lookup;
  const areaName = area === null ? null : tDynamic(`area.${area.code}`);
  const { unit, n } = distance(tour.distanceM, lang);
  const walk = unit === 'm' ? t('distance.m', { n }) : t('distance.km', { n });
  const hours = Math.max(0.5, Math.round(tour.estimatedMinutes / 30) / 2);
  const about =
    tour.estimatedMinutes < 60
      ? t('tour.aboutMinutes', { m: tour.estimatedMinutes })
      : t('tour.about', { h: hours });
  const note =
    tour.text.contentTier === 'REQUESTED' || tour.text.lang === lang
      ? null
      : t('tour.shownIn', {
          language: languageName(tour.text.lang, lang),
          page: languageName(lang, lang),
        });

  return (
    <TourStops
      tour={tour}
      area={area}
      header={
        <>
          {areaName === null ? null : (
            <nav
              aria-label={t('tour.breadcrumb', { area: areaName })}
              className="hidden text-sm text-muted-foreground desk:block"
            >
              {t('tour.breadcrumb', { area: areaName })}
            </nav>
          )}
          {tour.coverVariants === null ? null : (
            <img
              src={tour.coverVariants.full.url}
              alt=""
              className="aspect-video w-full object-cover desk:rounded-lg"
            />
          )}
          <div className="flex flex-col gap-4 px-4 desk:p-0">
            <p className="flex items-center gap-1 text-sm font-medium text-primary">
              <Route aria-hidden className="size-4" />
              {areaName === null ? t('tours.tours') : t('tour.eyebrow', { area: areaName })}
            </p>
            <h1 lang={tour.text.lang} className="text-2xl font-semibold text-foreground">
              {tour.text.title}
            </h1>
            <p className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <ListOrdered aria-hidden className="size-4" />
                {t('tours.stops', { n: tour.stopCount })}
              </span>
              <span className="inline-flex items-center gap-1">
                <Timer aria-hidden className="size-4" />
                {about}
              </span>
              <span className="inline-flex items-center gap-1">
                <Footprints aria-hidden className="size-4" />
                {t('tour.walk', { distance: walk })}
              </span>
            </p>
            {note === null ? null : <p className="text-sm text-muted-foreground">{note}</p>}
            <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
              {t('tour.honest')}
            </p>
          </div>
        </>
      }
      footer={<p className="text-sm text-muted-foreground">{t('tour.editorial')}</p>}
    />
  );
}
