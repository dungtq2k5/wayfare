'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  ownerPlacesDeactivate,
  ownerPlacesGet,
  ownerPlacesReactivate,
} from '@wayfare/api-client';
import { scopeCoversLanguage } from '@wayfare/contracts';
import type { Language, NarrationLanguageScope } from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { ConfirmDialog } from '@wayfare/ui/dialogs';
import { PageHeader } from '@wayfare/ui/list';
import { PlaceMap } from '@wayfare/ui/map';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@wayfare/ui/menu';
import { Card, StatusBadge } from '@wayfare/ui/surfaces';
import { toast } from '@wayfare/ui/toaster';
import { DoorClosed, DoorOpen, Ellipsis, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { errorText } from '../client/errors';
import { useMapStyle } from '../content/place-page';
import { Facts, focusSection, HoursList, Section } from '../content/place-sections';
import { QrSection } from '../content/qr-section';
import { useNames } from '../content/reference';
import { SponsoredChip } from '../components/sponsored-chip';
import { VenueBoostCard } from './boosts';
import { FieldCard } from '../content/submission-diff';
import type { PhotoSource } from '../content/submission-diff';
import { printedCode } from '../content/words';
import { formatDate, formatDuration, formatPhone } from '../i18n/format';
import { languageName } from '../i18n/language-names';
import { useConsole } from '../i18n/provider';
import { money } from './money';
import { OWNER_KEYS, useBillingOverview, useLimits, useOwnerPlaces, usePlans } from './queries';
import type { OwnerPlaceDetail } from './queries';
import { Notice } from './registration';
import { VenueStatus } from './venues';
import { narrationLanguages } from './words';

type Place = OwnerPlaceDetail['place'];

/** *Narration* (M2): each language the plan covers with its state, then those it doesn't. */
function OwnerNarration({ place, scope }: { place: Place; scope: NarrationLanguageScope }) {
  const { t, locale } = useConsole();
  const plans = usePlans();
  const byLang = new Map(place.localizations.map((row) => [row.lang, row]));
  const rows = narrationLanguages(scope);
  const playing = rows.filter((row) => row.inPlan).map((row) => row.lang);
  const lacking = rows.filter((row) => !row.inPlan).map((row) => row.lang);
  // The first plan that narrates every language this one lacks.
  const adder = plans.data?.find((plan) =>
    lacking.every((lang: Language) =>
      scopeCoversLanguage(plan.grants.narrationLanguageScope as NarrationLanguageScope, lang),
    ),
  )?.name;
  return (
    <Section id="narration" title={t('narration.title')}>
      <p className="text-sm text-muted-foreground">{t('venuePage.narrationLead')}</p>
      <ul className="flex flex-col divide-y divide-border text-sm">
        {playing.map((lang) => {
          const row = byLang.get(lang);
          const ready = row?.audioStatus === 'READY' && row.audioDurationMs !== null;
          return (
            <li key={lang} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-foreground">{languageName(lang, locale)}</span>
              {ready ? (
                <span className="flex items-center gap-2">
                  <StatusBadge tone="active">{t('narration.ready')}</StatusBadge>
                  <span className="text-muted-foreground">
                    {formatDuration(row.audioDurationMs ?? 0)}
                  </span>
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <StatusBadge tone="processing">{t('venuePage.beingMade')}</StatusBadge>
                  <span className="text-muted-foreground">{t('venuePage.beingMadeLine')}</span>
                </span>
              )}
            </li>
          );
        })}
        {/* The languages the plan lacks, in one row: the ones that play mustn't drown. */}
        {lacking[0] === undefined ? null : (
          <li className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="text-muted-foreground">
              {lacking.length === 1
                ? languageName(lacking[0], locale)
                : t('venuePage.notInPlanMore', {
                    first: languageName(lacking[0], locale),
                    n: lacking.length - 1,
                  })}
            </span>
            <span className="flex items-center gap-2">
              <StatusBadge tone="inactive">{t('venuePage.notInPlan')}</StatusBadge>
              {adder === undefined ? null : (
                <span className="text-muted-foreground">
                  {t('venuePage.planAdds', { plan: adder })}
                </span>
              )}
            </span>
          </li>
        )}
      </ul>
    </Section>
  );
}

/**
 * A venue's page (M2–M4b; K5, K6, K14): what tourists see, and first what is waiting for review,
 * field by field from the server's diff; *Close for now* asks, and its toast alone offers Undo;
 * *Reopen* goes through the plan's limit; a venue Wayfare took down has no *Reopen*. *Set by
 * Wayfare* is text, never inputs; there is no History (owners hold no `audit.read`).
 */
export function OwnerVenuePage({ initial }: { initial: OwnerPlaceDetail }) {
  const translator = useConsole();
  const { t, locale } = translator;
  const names = useNames();
  const queries = useQueryClient();
  const detail = useQuery({
    queryKey: OWNER_KEYS.place(initial.place.id),
    queryFn: async () => (await ownerPlacesGet(initial.place.id)).data,
    initialData: initial,
  });
  const billing = useBillingOverview();
  const limits = useLimits();
  const { place, pendingSubmission, boosted } = detail.data;
  const mapStyle = useMapStyle(place.areaId);
  const [dialog, setDialog] = useState<'close' | 'reopen' | null>(null);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<{ title?: string; body: string; plans?: boolean } | null>(
    null,
  );
  const toQr = useRef(false);
  const plan = billing.data?.plan.name ?? '';
  const owned = useOwnerPlaces();
  // The venue holding a one-place plan's place, to name it when reopening is refused (M4).
  const other = owned.data?.find(
    (row) =>
      row.id !== initial.place.id && (row.status === 'ACTIVE' || row.status === 'PROCESSING'),
  );
  const router = useRouter();
  const date = (iso: string) => formatDate(iso, locale);
  const status = place.status;
  const reason = place.inactiveReason;
  const takenDown = status === 'INACTIVE' && reason === 'ADMIN';
  const canReopen = status === 'INACTIVE' && !takenDown;

  const refresh = async () => {
    void queries.invalidateQueries({ queryKey: OWNER_KEYS.places });
    void queries.invalidateQueries({ queryKey: OWNER_KEYS.limits });
    await detail.refetch();
  };

  const refusal = (error: unknown): NonNullable<typeof alert> => {
    if (error instanceof ApiError && error.code === 'PLACE_LIMIT_REACHED') {
      return {
        title: t('venuePage.reopenRefused', { venue: place.nameVi }),
        body:
          limits.data?.maxPlaces === 1 && other !== undefined
            ? t('venuePage.reopenLimitOne', { plan, other: other.nameVi })
            : t('venuePage.reopenLimit', { plan, max: limits.data?.maxPlaces ?? 0 }),
        plans: true,
      };
    }
    if (error instanceof ApiError && error.code === 'AREA_INACTIVE') {
      return { body: t('venuePage.areaInactive', { area: names.area(place.areaCode) }) };
    }
    if (error instanceof ApiError && error.code === 'INVALID_STATE') {
      return dialog === 'close'
        ? { body: t('venuePage.notLive') }
        : {
            title: t('venuePage.takenDownTitle'),
            body: t('venuePage.takenDownBody', { date: date(place.statusChangedAt) }),
          };
    }
    return { body: errorText(error, translator) };
  };

  const reopen = async (fromUndo: boolean) => {
    if (busy) return;
    setBusy(true);
    setAlert(null);
    try {
      await ownerPlacesReactivate(place.id);
      setDialog(null);
      toast.success(t('venuePage.reopened', { venue: place.nameVi }));
      await refresh();
    } catch (error) {
      if (fromUndo) toast.error(refusal(error).body, { duration: Infinity });
      else setAlert(refusal(error));
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    if (busy) return;
    setBusy(true);
    setAlert(null);
    try {
      await ownerPlacesDeactivate(place.id);
      setDialog(null);
      // The round's only Undo (K14): nobody else is told, and reopening is its plain inverse.
      toast.success(t('venuePage.closed', { venue: place.nameVi }), {
        description: t('venuePage.closedBody'),
        action: { label: t('venuePage.undo'), onClick: () => void reopen(true) },
      });
      await refresh();
    } catch (error) {
      setAlert(refusal(error));
    } finally {
      setBusy(false);
    }
  };

  const photoSource: PhotoSource = (photo) =>
    place.photos.find((item) => item.id === photo.photoId)?.card.url;
  const diff = pendingSubmission?.diff ?? [];
  const currencyLine = place.menuCurrency === 'USD' ? t('venuePage.dollars') : t('venuePage.dong');

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/owner/venues" className="text-sm text-muted-foreground hover:underline">
            {t('venues.title')}
          </Link>
        }
        title={place.nameVi}
        badges={
          <span className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {t('venuePage.kind')}
            </span>
            <VenueStatus venue={place} since={place.statusChangedAt} inline />
            {boosted === null || boosted === undefined ? null : <SponsoredChip />}
          </span>
        }
        description={[
          printedCode(place.publicCode),
          names.area(place.areaCode),
          names.category(place.categoryCode),
        ].join(' · ')}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {status === 'ACTIVE' ? (
              <Button variant="outline" onClick={() => setDialog('close')}>
                <DoorClosed aria-hidden />
                {t('venuePage.close')}
              </Button>
            ) : canReopen ? (
              <Button variant="outline" onClick={() => setDialog('reopen')}>
                <DoorOpen aria-hidden />
                {t('venuePage.reopen')}
              </Button>
            ) : null}
            <Button asChild>
              <Link href={`/owner/venues/${place.id}/edit`}>
                <Pencil aria-hidden />
                {t('venuePage.propose')}
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t('venuePage.more')}>
                  <Ellipsis aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                onCloseAutoFocus={(event) => {
                  if (!toQr.current) return;
                  toQr.current = false;
                  event.preventDefault();
                  focusSection('qr');
                }}
              >
                <DropdownMenuItem onSelect={() => (toQr.current = true)}>
                  {t('place.qr')}
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/owner/submissions">{t('venues.mySubmissions')}</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />
      {takenDown ? (
        <Notice tone="error" title={t('venuePage.takenDownTitle')}>
          {t('venuePage.takenDownBody', { date: date(place.statusChangedAt) })}
        </Notice>
      ) : status === 'INACTIVE' && reason === 'ENTITLEMENT_LIMIT' ? (
        <Notice tone="warning" title={t('venuePage.offMapTitle')}>
          {t('venuePage.offMapBody')}
        </Notice>
      ) : null}

      {pendingSubmission === null ? null : (
        <Card className="flex flex-col gap-4 border-info" aria-labelledby="waiting-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="waiting-heading" className="text-lg font-semibold text-foreground">
              {t('venuePage.waiting')}
            </h2>
            <Button asChild variant="outline" size="sm">
              <Link href={`/owner/submissions/${pendingSubmission.id}`}>
                {t('venuePage.seeSubmission')}
              </Link>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            {t('venuePage.waitingLine', { date: date(pendingSubmission.submittedAt) })}
          </p>
          {diff.map((entry) => (
            <FieldCard
              key={entry.field}
              field={entry.field}
              columns={[
                { label: t('venuePage.touristsSee'), value: entry.before },
                { label: t('venuePage.waiting'), value: entry.after },
              ]}
              conflict={false}
              photoSource={photoSource}
              mapStyle={mapStyle}
              changesOnly
            />
          ))}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Section id="details" title={t('place.details')}>
            <Facts
              rows={[
                [t('place.name'), place.nameVi],
                [t('place.category'), names.category(place.categoryCode)],
                [t('place.address'), place.addressVi ?? t('place.none')],
                [
                  t('place.description'),
                  <span key="d" className="whitespace-pre-wrap">
                    {place.descriptionVi}
                  </span>,
                ],
                ...(place.priceBand === null
                  ? []
                  : [
                      [t('place.price'), t('place.priceRange', { band: place.priceBand })] as const,
                    ]),
                ...(place.phone === null
                  ? []
                  : [[t('place.phone'), formatPhone(place.phone)] as const]),
                ...(place.websiteUrl === null
                  ? []
                  : [[t('place.website'), place.websiteUrl] as const]),
              ]}
            />
          </Section>
          <Section id="photos" title={t('place.photos')}>
            {place.photos.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('place.noPhotos')}</p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {place.photos.map((photo) => (
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
            )}
            {place.photos.length === 0 || limits.data === undefined ? null : (
              <p className="text-xs text-muted-foreground">
                {t('venuePage.photoCount', {
                  count: place.photos.length,
                  max: limits.data.maxPhotosPerPlace,
                })}
              </p>
            )}
          </Section>
          <Section id="hours" title={t('place.hours')}>
            <HoursList rows={place.openingHours} />
          </Section>
          <Section id="menu" title={t('place.menu')}>
            {place.menuItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('place.noMenu')}</p>
            ) : (
              <>
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {place.menuItems.map((item) => (
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
                          : money(
                              { amountMinor: item.priceMinor, currency: place.menuCurrency },
                              locale,
                            )}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">{currencyLine}</p>
              </>
            )}
          </Section>
          {limits.data === undefined ? null : (
            <OwnerNarration
              place={place}
              scope={limits.data.narrationLanguageScope as NarrationLanguageScope}
            />
          )}
          <Section id="set-by-wayfare" title={t('venuePage.setByWayfare')}>
            <Facts
              rows={[
                [t('venuePage.radius'), t('venuePage.radiusValue', { n: place.triggerRadiusM })],
                [
                  t('venuePage.priority'),
                  t('venuePage.priorityValue', { n: place.narrationPriority }),
                ],
              ]}
            />
            <p className="text-xs text-muted-foreground">{t('venuePage.setWhy')}</p>
          </Section>
          {/* Read with *Set by Wayfare* above: what money changes, and what it never does. */}
          {place.kind === 'VENUE' && boosted !== undefined ? (
            <VenueBoostCard
              venueId={place.id}
              venueName={place.nameVi}
              since={boosted?.since ?? null}
            />
          ) : null}
          <QrSection
            placeId={place.id}
            name={place.nameVi}
            code={place.publicCode}
            src={`/owner/places/${place.id}/qr`}
          />
        </div>
        <div className="flex flex-col gap-6">
          <Section id="facts" title={t('place.facts')}>
            <Facts
              rows={[
                [
                  t('venuePage.code'),
                  <span key="c" className="font-mono">
                    {printedCode(place.publicCode)}
                  </span>,
                ],
                [t('place.area'), names.area(place.areaCode)],
                ...(limits.data === undefined
                  ? []
                  : [
                      [
                        t('ownerHome.auto'),
                        limits.data.autoNarration ? t('venues.startsItself') : t('venues.onTap'),
                      ] as const,
                    ]),
                // Live since its approval: kept for a venue taken down, as its record.
                [t('venuePage.liveSince'), date(place.createdAt)],
              ]}
            />
          </Section>
          <Section id="location" title={t('place.location')}>
            {mapStyle === null ? null : (
              <PlaceMap style={mapStyle} center={place.location} label={t('place.location')} />
            )}
            <Facts
              rows={[
                [
                  t('place.coordinates'),
                  `${place.location.lat.toFixed(4)}, ${place.location.lng.toFixed(4)}`,
                ],
              ]}
            />
          </Section>
        </div>
      </div>

      <ConfirmDialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
            setAlert(null);
          }
        }}
        title={
          dialog === 'reopen'
            ? t('venuePage.reopenTitle', { venue: place.nameVi })
            : t('venuePage.closeTitle', { venue: place.nameVi })
        }
        description={dialog === 'reopen' ? t('venuePage.reopenBody') : t('venuePage.closeBody')}
        // Refused at the limit, reopening can't succeed: *See plans* is the dialog's action (M4).
        confirm={
          alert?.plans === true
            ? t('venues.seePlans')
            : dialog === 'reopen'
              ? t('venuePage.reopen')
              : t('venuePage.close')
        }
        busy={busy ? t('action.saving') : undefined}
        alert={
          alert === null ? undefined : (
            <div className="flex flex-col gap-2">
              {alert.title === undefined ? null : <p className="font-medium">{alert.title}</p>}
              <p>{alert.body}</p>
            </div>
          )
        }
        labels={{
          cancel: dialog === 'reopen' ? t('action.close') : t('venuePage.keepOpen'),
          close: t('action.close'),
        }}
        onConfirm={() =>
          alert?.plans === true
            ? router.push('/owner/billing/plans')
            : void (dialog === 'reopen' ? reopen(false) : close())
        }
      />
    </>
  );
}
