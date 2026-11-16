'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, ownerBoostsRead, ownerBoostsSet } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { cn } from '@wayfare/ui/cn';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@wayfare/ui/dialog';
import { FormAlert } from '@wayfare/ui/field';
import { Card } from '@wayfare/ui/surfaces';
import { toast } from '@wayfare/ui/toaster';
import { CircleDashed, Pencil, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { errorText } from '../client/errors';
import { SponsoredChip } from '../components/sponsored-chip';
import { useNames } from '../content/reference';
import { formatDate } from '../i18n/format';
import { useConsole } from '../i18n/provider';
import { OWNER_KEYS, useBillingOverview, useOwnerPlaces, usePlans } from './queries';
import type { BillingOverview, OwnerPlaceRow } from './queries';
import { Notice } from './registration';

export type OwnerBoosts = Awaited<ReturnType<typeof ownerBoostsRead>>['data'];
type EndedBoost = OwnerBoosts['ended'][number];

/** The owner's boosts: the slots, the live ones, those ended in the last 90 days. */
export function useOwnerBoosts(enabled = true) {
  return useQuery({
    queryKey: OWNER_KEYS.boosts,
    enabled,
    queryFn: async () => (await ownerBoostsRead()).data,
  });
}

/** A number as a word, up to ten — "boosts five" — and as digits beyond. */
function useWords() {
  const { tDynamic } = useConsole();
  return (n: number) => (n >= 1 && n <= 10 ? tDynamic(`boosts.word.${n}`) : String(n));
}

/**
 * The newest boost the system ended that nothing has replaced since: the card says what happened
 * (BO5b, BO5c) until the owner boosts again.
 */
function lastSystemEnd(boosts: OwnerBoosts): EndedBoost | null {
  const newestStart = Math.max(0, ...boosts.live.map((boost) => Date.parse(boost.since)));
  const system = boosts.ended.filter((boost) => boost.endedReason !== 'OWNER');
  const newest = system.toSorted((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt))[0];
  return newest === undefined || Date.parse(newest.endedAt) < newestStart ? null : newest;
}

/** Whether the Venue left because its owner closed it, from its current status. */
const closedByOwner = (venue: OwnerPlaceRow | undefined) =>
  venue?.status === 'INACTIVE' && venue.inactiveReason === 'OWNER';

/**
 * *Discovery boosts* on *Plan and billing* (BO1, BO1b, BO3, BO5b, BO5c): how many slots are used,
 * the firewall in one sentence, each boosted Venue and since when, a dashed line for free slots,
 * what ended and why; *Choose venues*, or on Free *See plans*.
 */
export function BoostsCard({ overview }: { overview: BillingOverview }) {
  const { t, locale } = useConsole();
  const names = useNames();
  const boosts = useOwnerBoosts();
  const places = useOwnerPlaces();
  const [choosing, setChoosing] = useState(false);
  const data = boosts.data;
  if (data === undefined) {
    return boosts.isError ? (
      <Card className="flex flex-col gap-3" aria-labelledby="boosts-heading">
        <h2 id="boosts-heading" className="text-lg font-semibold text-foreground">
          {t('boosts.title')}
        </h2>
        <Notice tone="warning">{t('boosts.unavailable')}</Notice>
      </Card>
    ) : null;
  }
  const venueOf = (placeId: string) => (places.data ?? []).find((venue) => venue.id === placeId);
  const nameOf = (placeId: string) => venueOf(placeId)?.nameVi ?? t('boosts.unknownVenue');
  const date = (iso: string) => formatDate(iso, locale);
  const free = Math.max(0, data.slots - data.live.length);
  const end = lastSystemEnd(data);
  const onFree = data.slots === 0;

  const alert =
    end === null ? null : (
      <Notice tone="info" title={t('boosts.alertTitle', { venue: nameOf(end.placeId) })}>
        {end.endedReason === 'ENTITLEMENT_LIMIT'
          ? t(onFree ? 'boosts.alertPlanNone' : 'boosts.alertPlanFewer', {
              plan: overview.plan.name,
              date: date(end.endedAt),
              venue: nameOf(end.placeId),
            })
          : t(closedByOwner(venueOf(end.placeId)) ? 'boosts.alertClosed' : 'boosts.alertLeft', {
              venue: nameOf(end.placeId),
              date: date(end.endedAt),
            })}
      </Notice>
    );
  const why = (boost: EndedBoost) =>
    boost.endedReason === 'ENTITLEMENT_LIMIT'
      ? t('boosts.endedWhy.plan', { plan: overview.plan.name })
      : boost.endedReason === 'PLACE_UNAVAILABLE'
        ? t(
            closedByOwner(venueOf(boost.placeId))
              ? 'boosts.endedWhy.closed'
              : 'boosts.endedWhy.left',
          )
        : t('boosts.endedWhy.OWNER');
  const shortDate = (iso: string) =>
    new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
      day: 'numeric',
      month: 'short',
    }).format(new Date(iso));

  return (
    <Card className="flex flex-col gap-4" aria-labelledby="boosts-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="boosts-heading" className="text-lg font-semibold text-foreground">
          {t('boosts.title')}
          {/* The count is read with the heading. */}
          {onFree ? null : (
            <span className="sr-only">
              {' · '}
              {t('boosts.used', { used: data.live.length, slots: data.slots })}
            </span>
          )}
        </h2>
        {onFree ? null : (
          <span
            aria-hidden
            className="rounded-full bg-muted px-2 py-0.5 text-sm font-medium text-foreground"
          >
            {t('boosts.used', { used: data.live.length, slots: data.slots })}
          </span>
        )}
      </div>
      {onFree ? alert : null}
      <p className="text-sm text-muted-foreground">{t('boosts.firewall')}</p>
      {onFree ? <p className="text-sm text-foreground">{t('boosts.free')}</p> : alert}
      {data.live.length === 0 ? null : (
        <ul className="flex flex-col gap-2">
          {data.live.map((boost) => {
            const venue = venueOf(boost.placeId);
            return (
              <li
                key={boost.placeId}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-4 py-3"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <Link
                    href={`/owner/venues/${boost.placeId}`}
                    className="truncate rounded-sm text-base font-medium text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {nameOf(boost.placeId)}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {[
                      t('boosts.since', { date: date(boost.since) }),
                      venue === undefined ? null : names.area(venue.areaCode),
                    ]
                      .filter((part) => part !== null)
                      .join(' · ')}
                  </span>
                </span>
                <SponsoredChip />
              </li>
            );
          })}
        </ul>
      )}
      {free === 0 ? null : (
        <p className="flex items-center gap-2 rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          <CircleDashed aria-hidden className="size-4 shrink-0" />
          {free > 1
            ? t('boosts.freeMany', { n: free })
            : end === null
              ? t('boosts.freeOne')
              : t('boosts.freeYour')}
        </p>
      )}
      {data.ended.length === 0 ? null : (
        <section aria-labelledby="boosts-ended" className="flex flex-col gap-2">
          <h3 id="boosts-ended" className="text-sm font-medium text-muted-foreground">
            {t('boosts.ended')}
          </h3>
          <ul className="flex flex-col gap-2">
            {data.ended.map((boost) => (
              <li
                key={`${boost.placeId}-${boost.endedAt}`}
                className="flex flex-col gap-0.5 rounded-md bg-muted px-4 py-3"
              >
                <span className="text-base font-medium text-foreground">
                  {nameOf(boost.placeId)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t('boosts.endedRow', { from: shortDate(boost.since), to: date(boost.endedAt) })}
                  {' · '}
                  {why(boost)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {onFree ? (
        <Button asChild variant="outline" className="sm:self-start">
          <Link href="/owner/billing/plans">{t('boosts.seePlans')}</Link>
        </Button>
      ) : (
        <Button variant="outline" className="sm:self-start" onClick={() => setChoosing(true)}>
          <Pencil aria-hidden />
          {t('boosts.choose')}
        </Button>
      )}
      {choosing ? (
        <BoostChooser
          onClose={() => setChoosing(false)}
          boosts={data}
          planName={overview.plan.name}
        />
      ) : null}
    </Card>
  );
}

/** Why a Venue can't be boosted, from its status and inactive reason (BO2). */
function notLiveReason(venue: OwnerPlaceRow): string {
  if (venue.status === 'INACTIVE') return `boosts.notLive.${venue.inactiveReason ?? 'ADMIN'}`;
  return 'boosts.notLive.PROCESSING';
}

/**
 * The chooser (BO2, BO2b): the owner's Venues, live first, a checkbox each; one not live disabled
 * with why. More than the slots disables *Save boosts* with a warning — as a `409` does, the plan
 * having shrunk while the dialog was open. Sends the whole set.
 */
export function BoostChooser({
  onClose,
  boosts,
  planName,
}: {
  onClose: () => void;
  boosts: OwnerBoosts;
  planName: string;
}) {
  const translator = useConsole();
  const { t, tDynamic, locale } = translator;
  const names = useNames();
  const words = useWords();
  const places = useOwnerPlaces();
  const plans = usePlans();
  const queries = useQueryClient();
  const live = new Set(boosts.live.map((boost) => boost.placeId));
  const sinceOf = new Map(boosts.live.map((boost) => [boost.placeId, boost.since]));
  const [chosen, setChosen] = useState<Set<string>>(live);
  const [limit, setLimit] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const slots = limit ?? boosts.slots;
  const venues = (places.data ?? []).toSorted(
    (a, b) => Number(b.status === 'ACTIVE') - Number(a.status === 'ACTIVE'),
  );
  const over = chosen.size > slots;
  const bigger = (plans.data ?? [])
    .filter((plan) => plan.grants.discoveryBoostSlots > slots)
    .toSorted((a, b) => a.grants.discoveryBoostSlots - b.grants.discoveryBoostSlots)[0];

  const save = () => {
    setBusy(true);
    setAlert(null);
    ownerBoostsSet({ placeIds: [...chosen] }).then(
      async ({ data }) => {
        queries.setQueryData(OWNER_KEYS.boosts, data);
        await Promise.all([
          queries.invalidateQueries({ queryKey: OWNER_KEYS.places }),
          queries.invalidateQueries({ queryKey: OWNER_KEYS.billing }),
        ]);
        setBusy(false);
        onClose();
        toast.success(t('boosts.saved'));
      },
      (error: unknown) => {
        setBusy(false);
        if (error instanceof ApiError && error.code === 'BOOST_SLOTS_EXCEEDED') {
          const details = error.details as { limit?: number } | undefined;
          setLimit(details?.limit ?? boosts.slots);
          return;
        }
        setAlert(errorText(error, translator));
      },
    );
  };

  return (
    // Mounted only while open, so each opening starts from the live set.
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent closeLabel={t('action.close')} className="max-w-lg">
        <DialogHeader
          title={t('boosts.chooserTitle')}
          description={t('boosts.chooserLead', { slots, plan: planName, words: words(slots) })}
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">{t('boosts.chooserTitle')}</legend>
          {venues.map((venue) => {
            const isLive = venue.status === 'ACTIVE';
            const checked = chosen.has(venue.id);
            const since = sinceOf.get(venue.id);
            const reasonId = `boost-reason-${venue.id}`;
            return (
              <label
                key={venue.id}
                className={cn(
                  'flex items-start gap-3 rounded-md px-3 py-2',
                  checked && 'bg-accent',
                  isLive ? 'cursor-pointer' : 'cursor-not-allowed',
                )}
              >
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-primary"
                  checked={checked}
                  disabled={!isLive && !checked}
                  aria-describedby={reasonId}
                  onChange={(event) =>
                    setChosen((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(venue.id);
                      else next.delete(venue.id);
                      return next;
                    })
                  }
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span
                    className={cn(
                      'text-base font-medium',
                      isLive ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {venue.nameVi}
                  </span>
                  <span id={reasonId} className="text-xs text-muted-foreground">
                    {isLive
                      ? [
                          t('boosts.live'),
                          names.area(venue.areaCode),
                          since === undefined
                            ? null
                            : t('boosts.boostedSince', { date: formatDate(since, locale) }),
                        ]
                          .filter((part) => part !== null)
                          .join(' · ')
                      : tDynamic(notLiveReason(venue))}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
        {places.isError ? (
          <FormAlert
            action={
              <Button size="sm" variant="outline" onClick={() => void places.refetch()}>
                {t('action.retry')}
              </Button>
            }
          >
            {t('error.generic')}
          </FormAlert>
        ) : null}
        {over ? (
          <div role="alert">
            <Notice
              tone="warning"
              action={
                <Link
                  href="/owner/billing/plans"
                  className="rounded-sm text-sm text-primary underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t('boosts.seePlans')}
                </Link>
              }
            >
              {bigger === undefined
                ? t('boosts.overTop', { n: chosen.size, plan: planName, words: words(slots) })
                : t('boosts.over', {
                    n: chosen.size,
                    slots,
                    plan: planName,
                    words: words(slots),
                    bigger: bigger.name,
                    biggerWords: words(bigger.grants.discoveryBoostSlots),
                  })}
            </Notice>
          </div>
        ) : (
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {t('boosts.chosen', { n: chosen.size, slots })}
          </p>
        )}
        {alert === null ? null : (
          <Notice tone="error">
            <span className="flex items-center gap-2">
              <TriangleAlert aria-hidden className="size-4" />
              {alert}
            </span>
          </Notice>
        )}
        <p className="text-xs text-muted-foreground">{t('boosts.chooserFoot')}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('boosts.cancel')}
          </Button>
          {/* The whole set is sent, so it can't be saved before the Venues are known. */}
          <Button
            disabled={over || places.data === undefined}
            busy={busy ? t('boosts.saving') : undefined}
            onClick={save}
          >
            {t('boosts.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A Venue's *Discovery boost* card (BO4, BO4b), right after *Set by Wayfare*: boosted, since when,
 * and that its story plays exactly as before; not boosted, what a boost would do and whose slot is
 * in use. *Change boosts* or *Choose venues* opens the chooser.
 */
export function VenueBoostCard({
  venueId,
  venueName,
  since,
}: {
  venueId: string;
  venueName: string;
  since: string | null;
}) {
  const { t, locale } = useConsole();
  const boosts = useOwnerBoosts();
  const places = useOwnerPlaces();
  const overview = useBillingOverview();
  const [choosing, setChoosing] = useState(false);
  const data = boosts.data;
  if (data === undefined) return null;
  const planName = overview.data?.plan.name ?? '';
  const others = data.live
    .filter((boost) => boost.placeId !== venueId)
    .map((boost) => (places.data ?? []).find((venue) => venue.id === boost.placeId)?.nameVi)
    .filter((name) => name !== undefined);
  const free = Math.max(0, data.slots - data.live.length);
  return (
    <Card className="flex flex-col gap-3" aria-labelledby="venue-boost">
      <div className="flex items-center justify-between gap-2">
        <h2 id="venue-boost" className="text-lg font-semibold text-foreground">
          {t('boosts.venueTitle')}
        </h2>
        {since === null ? null : <SponsoredChip />}
      </div>
      {since === null ? (
        <p className="text-sm text-foreground">
          {t('boosts.venueOff', { venue: venueName })}{' '}
          {data.slots === 0
            ? t('boosts.free')
            : free > 0
              ? t('boosts.venueSlotsFree', { plan: planName, n: data.slots, free })
              : t('boosts.venueSlotsUsed', {
                  plan: planName,
                  n: data.slots,
                  others: others.join(', '),
                })}
        </p>
      ) : (
        <p className="text-sm text-foreground">
          {t('boosts.venueOn', { date: formatDate(since, locale), venue: venueName })}
        </p>
      )}
      {data.slots === 0 ? (
        <Button asChild variant="outline" className="sm:self-start">
          <Link href="/owner/billing/plans">{t('boosts.seePlans')}</Link>
        </Button>
      ) : (
        <Button variant="outline" className="sm:self-start" onClick={() => setChoosing(true)}>
          <Pencil aria-hidden />
          {since === null ? t('boosts.choose') : t('boosts.change')}
        </Button>
      )}
      {choosing ? (
        <BoostChooser onClose={() => setChoosing(false)} boosts={data} planName={planName} />
      ) : null}
    </Card>
  );
}
