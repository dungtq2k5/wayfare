'use client';

import { useQuery } from '@tanstack/react-query';
import { ApiError, adminToursActivate, adminToursGet } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { FormAlert } from '@wayfare/ui/field';
import { PageHeader } from '@wayfare/ui/list';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@wayfare/ui/menu';
import { RouteMap } from '@wayfare/ui/route-map';
import { StatusBadge } from '@wayfare/ui/surfaces';
import { toast } from '@wayfare/ui/toaster';
import { Eye, EyeOff, Info, Languages, LoaderCircle, Pencil, Ellipsis } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { errorText } from '../client/errors';
import { LINK_BASE_URL } from '../env';
import { formatDate } from '../i18n/format';
import { autonym } from '../i18n/language-names';
import { useConsole } from '../i18n/provider';
import { relativeTime } from '../notifications/text';
import { useCan } from '../shell/can';
import { useMapStyle } from './place-page';
import { Facts, focusSection, RecordHistory, Section } from './place-sections';
import { usePersonName } from './places-list';
import { QrSection } from './qr-section';
import { useNames } from './reference';
import { TourDeactivateDialog, TourDeleteDialog } from './tour-actions';
import { aboutHours, formatDistance } from './tour-words';
import { printedCode, statusTone } from './words';

/** A tour as the console reads it. */
export type TourDetail = Awaited<ReturnType<typeof adminToursGet>>['data'];
type Stop = TourDetail['stops'][number];

/** A stop tourists see: its Place live, not deleted, still in the tour's area. */
export const stopIsLive = (stop: Stop): boolean =>
  stop.status === 'ACTIVE' && !stop.deleted && !stop.outsideArea;

/** The tour's link as it is shared: the public host and `/t/` with the code, `T4QX-8MRK`. */
export const tourLink = (code: string): string =>
  `${new URL(LINK_BASE_URL).host}/t/${code.slice(0, 4)}-${code.slice(4)}`;

/**
 * A tour's page (TA2, TA4, TA4b, TA6): round 34's Place page for a tour — its stops on the route
 * and in order, its text, its translations, the link and the sticker, its history — Facts and the
 * cover at the side. The gate on the English text is never silent (TA4), and it opening while the
 * page is open arrives in place with its toast (TA4b).
 */
export function TourPage({ initial }: { initial: TourDetail }) {
  const translator = useConsole();
  const { t, tDynamic, locale } = translator;
  const can = useCan();
  const names = useNames();
  const tour = useQuery({
    queryKey: ['tour', initial.id],
    queryFn: async () => (await adminToursGet(initial.id)).data,
    initialData: initial,
    // The gate opens on catalog's own event: while Processing, the page reads it again.
    // ponytail: a 5 s re-read in one transient state, as a Place's page.
    refetchInterval: (query) => (query.state.data?.status === 'PROCESSING' ? 5000 : false),
  });
  const data = tour.data;
  const [dialog, setDialog] = useState<'deactivate' | 'delete' | null>(null);
  const [gate, setGate] = useState<string | null>(null);
  const mapStyle = useMapStyle(data.areaId);
  const maker = usePersonName(data.createdById);
  const previous = useRef(data.status);
  useEffect(() => {
    if (window.location.hash === '#qr') focusSection('qr');
  }, []);
  // TA4b: the English arrived while the page was open.
  useEffect(() => {
    if (data.status === 'ACTIVE' && previous.current === 'PROCESSING') {
      toast.success(t('tour.liveTitle', { title: data.titleVi }), {
        description: t('tour.liveBody', { area: names.area(data.areaCode) }),
      });
    }
    previous.current = data.status;
  }, [data.status, data.titleVi, data.areaCode, names, t]);

  const refetch = () => void tour.refetch();
  const activate = () =>
    void adminToursActivate(data.id).then(
      () => {
        setGate(null);
        refetch();
      },
      (error: unknown) =>
        setGate(
          error instanceof ApiError && error.code === 'AREA_INACTIVE'
            ? t('tour.areaInactive', { area: names.area(data.areaCode) })
            : errorText(error, translator),
        ),
    );

  const deleted = data.deletedAt !== null;
  const status = data.status;
  const showGate = status === 'PROCESSING' && data.activationMissing.includes('en.text');
  const distance = formatDistance(data.distanceM, locale);
  const hours = aboutHours(data.estimatedMinutes);
  const timeShort =
    data.estimatedMinutes < 60
      ? t('tours.minutes', { m: data.estimatedMinutes })
      : t('tours.hours', { h: hours });
  const now = new Date();
  const editStops = can('tour.manage') && !deleted ? `/tours/${data.id}/edit#stops` : undefined;
  const stops = data.stops.map((stop) => ({
    point: stop.location,
    label: String(stop.position + 1),
    faded: !stopIsLive(stop),
  }));

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/tours" className="text-sm text-muted-foreground hover:underline">
            {t('tours.title')}
          </Link>
        }
        title={data.titleVi}
        badges={
          <>
            <StatusBadge tone={deleted ? 'inactive' : statusTone(status)}>
              {deleted ? t('tours.deleted') : tDynamic(`status.${status}`)}
            </StatusBadge>
            {data.hiddenFromTourists && !deleted ? (
              <span className="rounded-full bg-warning px-2 py-0.5 text-xs font-medium text-warning-foreground">
                {t('tours.hidden')}
              </span>
            ) : null}
          </>
        }
        description={t('tour.headerFacts', {
          code: printedCode(data.publicCode),
          area: names.area(data.areaCode),
          stops: t('tour.stopCount', { n: data.stops.length }),
          distance,
          time: timeShort,
        })}
        action={
          deleted ? undefined : (
            <div className="flex flex-wrap items-center gap-2">
              {status === 'ACTIVE' || status === 'PROCESSING' ? (
                <Button variant="outline" onClick={() => setDialog('deactivate')}>
                  <EyeOff aria-hidden />
                  {t('tour.deactivate')}
                </Button>
              ) : (
                <Button variant="outline" onClick={activate}>
                  <Eye aria-hidden />
                  {t('tour.activate')}
                </Button>
              )}
              <Button asChild>
                <Link href={`/tours/${data.id}/edit`}>
                  <Pencil aria-hidden />
                  {t('tour.edit')}
                </Link>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={t('tour.moreActions')}>
                    <Ellipsis aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setTimeout(() => focusSection('qr'))}>
                    {t('tour.qr')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => setDialog('delete')}
                    className="text-destructive"
                  >
                    {t('tour.delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        }
      />
      {showGate ? (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-md bg-info px-4 py-3 text-sm text-info-foreground"
        >
          <strong className="flex items-center gap-2">
            <Info aria-hidden className="size-4 shrink-0" />
            {t('tour.gateTitle')}
          </strong>
          <span className="pl-6">{t('tour.gateBody')}</span>
          <span className="flex items-center gap-2 pl-6">
            <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
            {t('tour.gateText')}
          </span>
        </div>
      ) : null}
      {gate === null ? null : <FormAlert>{gate}</FormAlert>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Section
            id="stops"
            title={t('tour.stops')}
            edit={
              editStops === undefined ? undefined : { href: editStops, label: t('tour.editStops') }
            }
          >
            {mapStyle === null || stops.length === 0 ? null : (
              <RouteMap style={mapStyle} stops={stops} label={t('tour.stops')} />
            )}
            <ol className="flex flex-col divide-y divide-border">
              {data.stops.map((stop, index) => {
                const live = stopIsLive(stop);
                const note = stop.deleted
                  ? t('tour.goneStop')
                  : stop.outsideArea
                    ? t('tour.outsideArea')
                    : live
                      ? null
                      : t('tour.notLiveStop');
                return (
                  <li key={stop.position} className="flex items-center gap-3 py-2 text-sm">
                    <span
                      aria-hidden
                      className={`flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-medium ${live ? 'border-primary text-primary' : 'border-dashed border-muted-foreground text-muted-foreground'}`}
                    >
                      {stop.position + 1}
                    </span>
                    <span className="flex min-w-0 grow flex-col">
                      <span className={live ? 'text-foreground' : 'text-muted-foreground'}>
                        {stop.nameEn ?? stop.nameVi}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {stop.nameVi} · {names.category(stop.categoryCode)}
                      </span>
                      {note === null ? null : (
                        <span className="text-xs text-muted-foreground">{note}</span>
                      )}
                    </span>
                    <StatusBadge tone={stop.deleted ? 'inactive' : statusTone(stop.status)}>
                      {stop.deleted ? t('tours.deleted') : tDynamic(`status.${stop.status}`)}
                    </StatusBadge>
                    <span className="w-28 shrink-0 text-right text-xs text-muted-foreground">
                      {index === 0
                        ? t('tour.startHere')
                        : t('tour.legFrom', {
                            distance: formatDistance(stop.legM, locale),
                            n: index,
                          })}
                    </span>
                  </li>
                );
              })}
            </ol>
          </Section>
          <Section id="text" title={t('tour.text')}>
            <Facts
              rows={[
                [t('tour.titleField'), data.titleVi],
                [
                  t('tour.description'),
                  <span key="d" className="whitespace-pre-wrap">
                    {data.descriptionVi}
                  </span>,
                ],
              ]}
            />
            <p className="text-xs text-muted-foreground">{t('tour.textNote')}</p>
          </Section>
          <Section
            id="translations"
            title={t('tour.translations')}
            edit={
              can('localization.edit')
                ? {
                    href: `/narration/corrections/TOUR/${data.id}`,
                    label: t('tour.correct'),
                    icon: <Languages aria-hidden />,
                  }
                : undefined
            }
          >
            <Facts
              rows={[
                [t('tour.sourceLang', { language: autonym('vi') }), t('tour.source')],
                ...data.localizations
                  .filter((row) => row.lang !== 'vi')
                  .map(
                    (row) =>
                      [
                        autonym(row.lang),
                        row.stale
                          ? t('tour.stale')
                          : row.translationSource === 'HUMAN'
                            ? t('tour.corrected')
                            : t('tour.machineReady'),
                      ] as const,
                  ),
              ]}
            />
          </Section>
          <QrSection
            placeId={data.id}
            name={data.titleVi}
            code={data.publicCode}
            src={`/admin/tours/${data.id}/qr`}
            title={t('tour.linkTitle')}
            body={t('tour.linkBody', { code: printedCode(data.publicCode) })}
            link={tourLink(data.publicCode)}
          />
          {can('audit.read') ? (
            <RecordHistory resourceType="TOUR" resourceId={data.id} createdAt={data.createdAt} />
          ) : null}
        </div>
        <div className="flex flex-col gap-6">
          <Section id="facts" title={t('tour.facts')}>
            <Facts
              rows={[
                [t('tour.code'), <code key="c">{printedCode(data.publicCode)}</code>],
                [t('tour.area'), names.area(data.areaCode)],
                [
                  t('tours.stops'),
                  t('tours.liveOf', { live: data.liveStops, total: data.stops.length }),
                ],
                [t('tour.walk'), t('tour.walkValue', { distance })],
                [
                  t('tour.time'),
                  data.estimatedMinutes < 60
                    ? t('tour.timeMinutes', { min: data.estimatedMinutes })
                    : t('tour.timeValue', { h: hours, min: data.estimatedMinutes }),
                ],
                [
                  t('tour.created'),
                  maker == null
                    ? formatDate(data.createdAt, locale)
                    : t('tour.createdBy', {
                        date: formatDate(data.createdAt, locale),
                        name: maker,
                      }),
                ],
                [t('tour.updated'), relativeTime(data.updatedAt, now, translator)],
              ]}
            />
          </Section>
          <Section
            id="cover"
            title={t('tour.cover')}
            edit={
              deleted
                ? undefined
                : { href: `/tours/${data.id}/edit#cover`, label: t('tour.change') }
            }
          >
            {data.cover === null ? (
              <p className="text-sm text-muted-foreground">{t('tour.noCover')}</p>
            ) : (
              <img
                src={data.cover.card.url}
                alt=""
                className="aspect-video w-full rounded-md object-cover"
              />
            )}
          </Section>
        </div>
      </div>

      {dialog === 'deactivate' ? (
        <TourDeactivateDialog
          tour={data}
          open
          onOpenChange={() => setDialog(null)}
          onChanged={refetch}
        />
      ) : null}
      {dialog === 'delete' ? (
        <TourDeleteDialog tour={data} open onOpenChange={() => setDialog(null)} />
      ) : null}
    </>
  );
}
