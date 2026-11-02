'use client';

import { useQuery } from '@tanstack/react-query';
import { notificationsUnreadCount, ownerSubmissionsList } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { Progress } from '@wayfare/ui/content';
import { PageHeader } from '@wayfare/ui/list';
import { Card } from '@wayfare/ui/surfaces';
import { toast } from '@wayfare/ui/toaster';
import { Bell, ChevronRight, CreditCard, FileX, MapPinOff, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { errorText } from '../client/errors';
import { printedCode } from '../content/words';
import { useConsole } from '../i18n/provider';
import { UNREAD_KEY } from '../shell/notifications-socket';
import { useBillingOverview, useLimits, useOwnerPlaces } from './queries';
import type { OwnerSubmissionRow } from './queries';
import { openPortal } from './stripe';
import { usageText, VenueStatus } from './venues';
import { homeView } from './words';

const SUPPORT = 'mailto:support@wayfare.app';

/** The newest submission per venue, when it was not approved: a change still needing the owner. */
export function rejectedChanges(rows: readonly OwnerSubmissionRow[]): OwnerSubmissionRow[] {
  const seen = new Set<string>();
  const needing: OwnerSubmissionRow[] = [];
  for (const row of rows) {
    const venue = row.placeId ?? row.id;
    if (seen.has(venue)) continue;
    seen.add(venue);
    if (row.status === 'REJECTED') needing.push(row);
  }
  return needing;
}

function NeedRow({ icon, text, action }: { icon: ReactNode; text: string; action: ReactNode }) {
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <span className="flex items-start gap-3 text-sm text-foreground">
        <span aria-hidden className="mt-0.5 text-muted-foreground [&_svg]:size-5">
          {icon}
        </span>
        {text}
      </span>
      <span className="shrink-0">{action}</span>
    </li>
  );
}

/** Approval's first visit (N8; K19): what Free gives, then the first steps. */
function Welcome() {
  const { t } = useConsole();
  return (
    <>
      <PageHeader title={t('welcome.title')} description={t('welcome.lead')} />
      <Card className="flex max-w-2xl flex-col gap-4" aria-labelledby="steps-heading">
        <h2 id="steps-heading" className="text-lg font-semibold text-foreground">
          {t('welcome.steps')}
        </h2>
        <p className="text-sm text-foreground">{t('welcome.free')}</p>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-foreground">
          <li>{t('welcome.add')}</li>
          <li>{t('welcome.qr')}</li>
          <li>{t('welcome.plans')}</li>
        </ol>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild>
            <Link href="/owner/venues/new">
              <Plus aria-hidden />
              {t('welcome.addVenue')}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/owner/billing/plans">{t('welcome.seePlans')}</Link>
          </Button>
        </div>
      </Card>
    </>
  );
}

/**
 * An owner's Home (Z1, Z1b, N8; K7, K19): *Needs you* first — a failed payment, a change not
 * approved, a venue Wayfare took down, new outcomes — each with its action; then the venues at a
 * glance and the plan at the side. Nothing to do is one line.
 */
export function OwnerHome() {
  const translator = useConsole();
  const { t } = translator;
  const places = useOwnerPlaces();
  const limits = useLimits();
  const billing = useBillingOverview();
  const recent = useQuery({
    queryKey: ['owner-submissions', 'recent'],
    queryFn: async () => (await ownerSubmissionsList({ limit: 20 })).data,
  });
  const unread = useQuery({
    queryKey: UNREAD_KEY,
    queryFn: async () => (await notificationsUnreadCount()).data.count,
  });
  const [opening, setOpening] = useState(false);

  if (places.data === undefined || recent.data === undefined) return null;
  if (homeView(places.data.length, recent.data.length) === 'welcome') return <Welcome />;

  const names = new Map(places.data.map((place) => [place.id, place.nameVi]));
  const needs: ReactNode[] = [];
  if (billing.data?.dunning != null) {
    needs.push(
      <NeedRow
        key="dunning"
        icon={<CreditCard />}
        text={t('ownerHome.dunning', { plan: billing.data.plan.name })}
        action={
          <Button
            size="sm"
            variant="outline"
            busy={opening ? t('billing.opening') : undefined}
            onClick={() => {
              setOpening(true);
              openPortal().catch((error: unknown) => {
                setOpening(false);
                toast.error(errorText(error, translator));
              });
            }}
          >
            {t('ownerHome.updateCard')}
          </Button>
        }
      />,
    );
  }
  for (const row of rejectedChanges(recent.data)) {
    needs.push(
      <NeedRow
        key={row.id}
        icon={<FileX />}
        text={t('ownerHome.rejected', {
          venue: (row.placeId === null ? undefined : names.get(row.placeId)) ?? row.payload.nameVi,
          note: row.decisionNote ?? '',
        })}
        action={
          <Button asChild size="sm" variant="outline">
            <Link href={`/owner/submissions/${row.id}`}>{t('ownerHome.seeNote')}</Link>
          </Button>
        }
      />,
    );
  }
  for (const place of places.data.filter(
    (row) => row.status === 'INACTIVE' && row.inactiveReason === 'ADMIN',
  )) {
    needs.push(
      <NeedRow
        key={place.id}
        icon={<MapPinOff />}
        text={t('ownerHome.takenDown', { venue: place.nameVi })}
        action={
          <Button asChild size="sm" variant="outline">
            <a href={SUPPORT}>{t('ownerHome.writeSupport')}</a>
          </Button>
        }
      />,
    );
  }
  if ((unread.data ?? 0) > 0) {
    needs.push(
      <NeedRow
        key="unread"
        icon={<Bell />}
        text={t('ownerHome.unread', { n: unread.data ?? 0 })}
        action={
          <Button asChild size="sm" variant="outline">
            <Link href="/owner/notifications">{t('ownerHome.openNotifications')}</Link>
          </Button>
        }
      />,
    );
  }

  return (
    <>
      <PageHeader title={t('home.title')} description={t('ownerHome.lead')} />
      <section aria-labelledby="needs-heading">
        <Card className="flex flex-col gap-1">
          <h2 id="needs-heading" className="text-lg font-semibold text-foreground">
            {t('ownerHome.needs')}
          </h2>
          {needs.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">{t('ownerHome.clear')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">{needs}</ul>
          )}
        </Card>
      </section>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <Card className="flex flex-col gap-3 lg:col-span-2" aria-labelledby="venues-heading">
          <div className="flex items-center justify-between gap-2">
            <h2 id="venues-heading" className="text-lg font-semibold text-foreground">
              {t('ownerHome.venues')}
            </h2>
            <Link
              href="/owner/venues"
              className="rounded-sm text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('ownerHome.allVenues')}
            </Link>
          </div>
          <ul className="flex flex-col divide-y divide-border">
            {places.data.map((place) => (
              <li key={place.id}>
                {/* M1's row, shorter: the name and its code, the status, a chevron. */}
                <Link
                  href={`/owner/venues/${place.id}`}
                  className="flex items-center gap-3 rounded-sm py-2 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {/* At phone width the status goes under the name, as M1's cards. */}
                  <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-sm font-medium text-foreground">{place.nameVi}</span>
                      <span className="font-mono text-xs whitespace-nowrap text-muted-foreground">
                        {printedCode(place.publicCode)}
                      </span>
                    </span>
                    <VenueStatus venue={place} since={place.statusChangedAt} inline />
                  </span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="flex flex-col gap-3" aria-labelledby="plan-heading">
          <h2 id="plan-heading" className="text-lg font-semibold text-foreground">
            {t('ownerHome.plan')}
          </h2>
          {billing.data === undefined ? null : (
            <p className="text-2xl font-semibold text-foreground">{billing.data.plan.name}</p>
          )}
          {limits.data === undefined ? null : (
            <Progress
              value={limits.data.used + limits.data.reservedByPendingSubmissions}
              max={limits.data.maxPlaces}
              label={usageText(limits.data, t)}
            />
          )}
          {limits.data === undefined ? null : (
            <p className="text-sm text-muted-foreground">
              {t('ownerHome.auto')}:{' '}
              {limits.data.autoNarration ? t('ownerHome.autoOn') : t('ownerHome.autoOff')}
            </p>
          )}
          <Link
            href="/owner/billing"
            className="self-start rounded-sm text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('ownerHome.planBilling')}
          </Link>
        </Card>
      </div>
    </>
  );
}
