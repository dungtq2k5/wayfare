'use client';

import { useQuery } from '@tanstack/react-query';
import { ApiError, adminPlacesActivate, adminPlacesGet } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { KindChip } from '@wayfare/ui/content';
import { FormAlert } from '@wayfare/ui/field';
import { PageHeader } from '@wayfare/ui/list';
import { PlaceMap } from '@wayfare/ui/map';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@wayfare/ui/menu';
import { StatusBadge } from '@wayfare/ui/surfaces';
import { toast } from '@wayfare/ui/toaster';
import { Clock, Ellipsis, Info, LoaderCircle, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../app/providers';
import { errorText } from '../client/errors';
import { useConsole } from '../i18n/provider';
import { relativeTime } from '../notifications/text';
import { useCan } from '../shell/can';
import { EditorialSection } from './editorial-section';
import { NarrationSection } from './narration-section';
import { DeactivateDialog, DeleteDialog, ownerName } from './place-actions';
import { Facts, focusSection, History, HoursList, Section } from './place-sections';
import type { PlaceDetail } from './place-types';
import { StuckAlert, StuckChip, useStuck } from '../operations/stuck';
import { QrSection } from './qr-section';
import { RegenerateDialog } from './regenerate-dialog';
import { narrationRows } from './narration-section';
import { useAreas, useNames } from './reference';
import { printedCode, radiusComparison, statusTone, waitKey } from './words';
import type { InactiveReason } from './words';
import { formatDate, formatPhone } from '../i18n/format';

/** The map style for the page's theme: the pack's dark one in dark, when it has one. */
export function useMapStyle(areaId: string): string | null {
  const areas = useAreas();
  const { theme } = useTheme();
  const pack = areas.data?.find((area) => area.id === areaId)?.mapPack ?? null;
  if (pack === null) return null;
  const dark =
    theme === 'dark' ||
    (theme === 'system' &&
      typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-color-scheme: dark)').matches);
  return dark && pack.styleDark !== null ? pack.styleDark : pack.style;
}

/**
 * A Place's page (L2, L2b, L2m): the header with the actions the reader's permissions allow —
 * absent, not greyed — the sections in the handoff's order, Facts and Location at the side. The
 * activation gate is never silent (L7), and a job finishing while the page is open refetches it, so
 * *Active* arrives in place with its toast (L7b).
 */
export function PlacePage({ initial }: { initial: PlaceDetail }) {
  const translator = useConsole();
  const { t, tDynamic } = translator;
  const can = useCan();
  const names = useNames();
  const place = useQuery({
    queryKey: ['place', initial.id],
    queryFn: async () => (await adminPlacesGet(initial.id)).data,
    initialData: initial,
    // A Place's status moves on catalog's own event, which only a Venue's owner hears, and a job's
    // end can arrive before catalog applies it: while Processing, the page reads it again.
    // ponytail: a 5 s re-read in one transient state; a staff socket event for status if it shows.
    refetchInterval: (query) => (query.state.data?.status === 'PROCESSING' ? 5000 : false),
  });
  const data = place.data;
  const [dialog, setDialog] = useState<'deactivate' | 'delete' | 'regenerate' | null>(null);
  const [gate, setGate] = useState<string | null>(null);
  const [draftRadius, setDraftRadius] = useState<number | null>(null);
  const mapStyle = useMapStyle(data.areaId);
  const previous = useRef(data.status);
  const toQr = useRef(false);
  // Arriving from a list's *QR sticker* (`#qr`): the section takes focus, as from the menu.
  useEffect(() => {
    if (window.location.hash === '#qr') focusSection('qr');
  }, []);

  // L7b: the audio arrived while the page was open.
  useEffect(() => {
    if (
      data.status === 'ACTIVE' &&
      previous.current !== 'ACTIVE' &&
      previous.current !== 'INACTIVE'
    ) {
      setGate(null);
      toast.success(t('gate.liveTitle'), {
        description: t('gate.liveBody', { name: data.nameVi }),
      });
    }
    previous.current = data.status;
  }, [data.status, data.nameVi, t]);

  const refetch = () => void place.refetch();
  const activate = () =>
    void adminPlacesActivate(data.id).then(
      () => refetch(),
      (error: unknown) =>
        setGate(
          error instanceof ApiError && error.code === 'AREA_INACTIVE'
            ? t('error.AREA_INACTIVE', { area: names.area(data.areaCode) })
            : errorText(error, translator),
        ),
    );

  const status = data.status;
  const kind = data.kind;
  const venue = kind === 'VENUE';
  const owner = ownerName(data, t('place.aVenueOwner'));
  const missing = data.activationMissing.filter((item) => item !== 'activation');
  const showGate = status === 'PROCESSING' && missing.length > 0;
  const now = new Date();
  const deleted = data.deletedAt !== null;
  const radius = draftRadius ?? data.triggerRadiusM;
  // A Place that waits says why (round 34 §2).
  const wait = waitKey(status, data.inactiveReason as InactiveReason | null);
  // X2: a Place processing too long with nothing making its audio says so at the top.
  const stuckList = useStuck();
  const stuck =
    !deleted &&
    status === 'PROCESSING' &&
    (stuckList.data ?? []).some((row) => row.place.id === data.id);

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/places" className="text-sm text-muted-foreground hover:underline">
            {t('places.title')}
          </Link>
        }
        title={data.nameVi}
        description={[
          printedCode(data.publicCode),
          names.area(data.areaCode),
          names.category(data.categoryCode),
          ...(venue ? [t('place.ownedBy', { owner })] : []),
        ].join(' · ')}
        action={
          deleted ? undefined : (
            <div className="flex flex-wrap items-center gap-2">
              {can('place.publish') && (status === 'ACTIVE' || status === 'PROCESSING') ? (
                <Button variant="outline" onClick={() => setDialog('deactivate')}>
                  {t('place.deactivate')}
                </Button>
              ) : null}
              {can('place.publish') && (status === 'DRAFT' || status === 'INACTIVE') ? (
                <Button variant="outline" onClick={activate}>
                  {t('place.activate')}
                </Button>
              ) : null}
              {can('place.update') ? (
                <Button asChild>
                  <Link href={`/places/${data.id}/edit`}>
                    <Pencil aria-hidden />
                    {t('place.edit')}
                  </Link>
                </Button>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={t('place.moreActions')}>
                    <Ellipsis aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  onCloseAutoFocus={(event) => {
                    // *QR sticker* moves focus to the section, not back to the menu's button.
                    if (!toQr.current) return;
                    toQr.current = false;
                    event.preventDefault();
                    focusSection('qr');
                  }}
                >
                  <DropdownMenuItem onSelect={() => (toQr.current = true)}>
                    {t('place.qr')}
                  </DropdownMenuItem>
                  {can('narration.job.manage') ? (
                    <DropdownMenuItem onSelect={() => setDialog('regenerate')}>
                      {t('place.regenerate')}
                    </DropdownMenuItem>
                  ) : null}
                  {can('place.delete') ? (
                    <DropdownMenuItem
                      onSelect={() => setDialog('delete')}
                      className="text-destructive"
                    >
                      {t('place.delete')}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        }
      />
      <div className="-mt-4 flex flex-wrap items-center gap-2">
        <KindChip kind={kind}>{tDynamic(`kind.${kind}`)}</KindChip>
        <StatusBadge tone={deleted ? 'inactive' : statusTone(status)}>
          {deleted ? t('places.deleted') : tDynamic(`status.${status}`)}
        </StatusBadge>
        {deleted || wait === null || stuck ? null : (
          <span className="text-sm text-muted-foreground">· {tDynamic(wait)}</span>
        )}
        {stuck ? <StuckChip /> : null}
      </div>
      {stuck ? <StuckAlert placeId={data.id} name={data.nameVi} /> : null}
      {venue ? (
        <p className="flex items-start gap-2 rounded-md bg-info px-3 py-2 text-sm text-info-foreground">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t('place.belongsTo', { name: data.nameVi, owner })}
        </p>
      ) : null}
      {/* A stuck Place's alert says what the gate would wrongly call "being made". */}
      {showGate && !stuck ? (
        // Nothing is wrong: the info style, each item with its live state's icon.
        <div
          role="status"
          className="flex flex-col gap-2 rounded-md bg-info px-4 py-3 text-sm text-info-foreground"
        >
          <strong className="flex items-center gap-2">
            <Info aria-hidden className="size-4 shrink-0" />
            {t('gate.title')}
          </strong>
          <ul className="flex flex-col gap-1 pl-6 [&_svg]:size-4 [&_svg]:shrink-0">
            {missing.includes('en.text') ? (
              <li className="flex items-center gap-2">
                <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
                {t('gate.enText')}
              </li>
            ) : null}
            {missing.includes('en.audio') ? (
              missing.includes('en.text') ? (
                <li className="flex items-center gap-2">
                  <Clock aria-hidden />
                  {t('gate.enAudio')}
                </li>
              ) : (
                <li className="flex items-center gap-2">
                  <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
                  {t('gate.enAudioMaking')}
                </li>
              )
            ) : null}
          </ul>
          <span className="pl-6">{t('gate.byItself')}</span>
        </div>
      ) : null}
      {gate === null ? null : <FormAlert>{gate}</FormAlert>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Section
            id="details"
            title={t('place.details')}
            edit={
              can('place.update') && !deleted
                ? { href: `/places/${data.id}/edit`, label: t('place.edit') }
                : undefined
            }
          >
            <Facts
              rows={[
                [t('place.name'), data.nameVi],
                [t('place.category'), names.category(data.categoryCode)],
                [t('place.address'), data.addressVi ?? t('place.none')],
                [
                  t('place.description'),
                  <span key="d" className="whitespace-pre-wrap">
                    {data.descriptionVi}
                  </span>,
                ],
                ...(data.priceBand === null
                  ? []
                  : [[t('place.price'), t('place.priceBand', { band: data.priceBand })] as const]),
                ...(data.phone === null
                  ? []
                  : [[t('place.phone'), formatPhone(data.phone)] as const]),
                ...(data.websiteUrl === null
                  ? []
                  : [[t('place.website'), data.websiteUrl] as const]),
              ]}
            />
          </Section>
          <Section
            id="photos"
            title={t('place.photos')}
            edit={
              can('place.update') && !deleted
                ? { href: `/places/${data.id}/edit#photos`, label: t('place.editPhotos') }
                : undefined
            }
          >
            {data.photos.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('place.noPhotos')}</p>
            ) : (
              <>
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {data.photos.map((photo) => (
                    <li key={photo.id} className="flex flex-col gap-1">
                      <img
                        src={photo.card.url}
                        alt={photo.altTextVi ?? ''}
                        className="aspect-video w-full rounded-md object-cover"
                      />
                      {photo.altTextVi === null ? null : (
                        <span className="text-xs text-muted-foreground">{photo.altTextVi}</span>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  {t('place.photoCount', { count: data.photos.length })}
                </p>
              </>
            )}
          </Section>
          <Section
            id="hours"
            title={t('place.hours')}
            edit={
              can('place.update') && !deleted
                ? { href: `/places/${data.id}/edit#hours`, label: t('place.edit') }
                : undefined
            }
          >
            <HoursList rows={data.openingHours} />
          </Section>
          {venue ? (
            <Section
              id="menu"
              title={t('place.menu')}
              edit={
                can('place.update') && !deleted
                  ? { href: `/places/${data.id}/edit#menu`, label: t('place.edit') }
                  : undefined
              }
            >
              {data.menuItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('place.noMenu')}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {data.menuItems.map((item) => (
                    <li key={item.id} className="flex items-baseline justify-between gap-3 py-2">
                      <span
                        className={
                          item.isAvailable
                            ? 'text-foreground'
                            : 'text-muted-foreground line-through'
                        }
                      >
                        {item.nameVi}
                      </span>
                      <span className="text-muted-foreground">
                        {item.priceMinor === null
                          ? t('place.none')
                          : `${new Intl.NumberFormat('vi-VN').format(item.priceMinor)} ₫`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          ) : null}
          {can('narration.job.read') ? (
            <NarrationSection
              placeId={data.id}
              name={data.nameVi}
              localizations={data.localizations}
              onJobDone={refetch}
            />
          ) : null}
          <EditorialSection
            placeId={data.id}
            radiusM={data.triggerRadiusM}
            priority={data.narrationPriority}
            canEdit={can('place.editorial.update') && !deleted}
            onDraftRadius={setDraftRadius}
            onSaved={refetch}
          />
          <QrSection placeId={data.id} name={data.nameVi} code={data.publicCode} />
          {can('audit.read') ? <History place={data} /> : null}
        </div>
        <div className="flex flex-col gap-6">
          <Section id="facts" title={t('place.facts')}>
            <Facts
              rows={[
                [t('places.code'), printedCode(data.publicCode)],
                [t('places.kind'), tDynamic(`kind.${kind}`)],
                ...(venue ? [[t('places.owner'), owner] as const] : []),
                [t('place.area'), names.area(data.areaCode)],
                [t('place.created'), formatDate(data.createdAt, translator.locale)],
                [t('place.updated'), relativeTime(data.updatedAt, now, translator)],
              ]}
            />
          </Section>
          <Section id="location" title={t('place.location')}>
            {mapStyle === null ? null : (
              <PlaceMap
                style={mapStyle}
                center={data.location}
                radiusM={radius}
                label={t('place.location')}
              />
            )}
            {draftRadius === null || Number.isNaN(draftRadius) ? null : (
              <p className="text-xs text-muted-foreground">
                {t('place.circleCaption', {
                  m: draftRadius,
                  comparison: t(radiusComparison(draftRadius)),
                })}
              </p>
            )}
            <Facts
              rows={[
                [
                  t('place.coordinates'),
                  `${data.location.lat.toFixed(4)}, ${data.location.lng.toFixed(4)}`,
                ],
              ]}
            />
          </Section>
        </div>
      </div>

      {dialog === 'deactivate' ? (
        <DeactivateDialog
          place={data}
          open
          onOpenChange={() => setDialog(null)}
          onChanged={refetch}
        />
      ) : null}
      {dialog === 'delete' ? (
        <DeleteDialog place={data} open onOpenChange={() => setDialog(null)} />
      ) : null}
      {dialog === 'regenerate' ? (
        <RegenerateDialog
          open
          onOpenChange={() => setDialog(null)}
          placeId={data.id}
          name={data.nameVi}
          localizations={narrationRows(data.localizations)}
          onStarted={refetch}
        />
      ) : null}
    </>
  );
}
