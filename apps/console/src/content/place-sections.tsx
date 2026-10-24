'use client';

import { useQuery } from '@tanstack/react-query';
import { auditLogsList } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { Card } from '@wayfare/ui/surfaces';
import { Pencil } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useConsole } from '../i18n/provider';
import { relativeTime } from '../notifications/text';
import { useMe } from '../shell/me';
import type { PlaceDetail } from './place-types';

/** A card with its title and, for someone who may, its *Edit*. */
export function Section({
  id,
  title,
  edit,
  children,
}: {
  id: string;
  title: string;
  edit?: { href: string; label: string } | undefined;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-4" aria-labelledby={id}>
      <div className="flex items-center justify-between gap-2">
        <h2 id={id} className="text-lg font-semibold text-foreground">
          {title}
        </h2>
        {edit === undefined ? null : (
          <Button asChild variant="ghost" size="sm">
            <Link href={edit.href}>
              <Pencil aria-hidden />
              {edit.label}
            </Link>
          </Button>
        )}
      </div>
      {children}
    </Card>
  );
}

/** Label and value rows, as Details and Facts set them out. */
export function Facts({ rows }: { rows: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="text-foreground sm:col-span-2">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Opening hours as the page shows them: weekdays first, then special dates. */
export function HoursList({ rows }: { rows: PlaceDetail['openingHours'] }) {
  const { t } = useConsole();
  if (rows.length === 0)
    return <p className="text-sm text-muted-foreground">{t('place.noHours')}</p>;
  const label = (row: PlaceDetail['openingHours'][number]) =>
    row.specificDate == null
      ? t('place.weekday', { day: String(row.weekday ?? '') })
      : row.specificDate;
  const value = (row: PlaceDetail['openingHours'][number]) =>
    row.isClosed ? t('place.closed') : `${row.opensAt ?? ''}–${row.closesAt ?? ''}`;
  const weekly = rows.filter((row) => row.specificDate === null);
  const special = rows.filter((row) => row.specificDate !== null);
  return (
    <Facts
      rows={[
        ...weekly
          .map((row, index) => [`${label(row)}#${index}`, value(row)] as const)
          .map(([key, v]) => [key.split('#')[0]!, v] as const),
        ...special.map(
          (row) => [`${t('place.specialDates')} · ${label(row)}`, value(row)] as const,
        ),
      ]}
    />
  );
}

/**
 * History (L2), for a reader holding `audit.read`: what happened to the Place, newest first, from
 * the audit log since it was created.
 */
export function History({ place }: { place: PlaceDetail }) {
  const translator = useConsole();
  const { t, tDynamic } = translator;
  const me = useMe();
  const log = useQuery({
    queryKey: ['place-history', place.id],
    queryFn: () =>
      auditLogsList({
        resourceId: place.id,
        from: place.createdAt,
        to: new Date().toISOString(),
        limit: 50,
      }),
  });
  const now = new Date();
  const rows = log.data?.data ?? [];
  const who = (actor: { type: string; userId: string | null }) =>
    actor.type === 'SYSTEM' || actor.userId === null
      ? t('place.system')
      : actor.userId === me.user.id
        ? t('history.you')
        : t('history.staff');
  return (
    <Section id="history" title={t('place.history')}>
      {log.isSuccess && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('place.historyEmpty')}</p>
      ) : (
        <ol className="flex flex-col divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-1 py-2 text-sm">
              <span className="font-medium text-foreground">
                {tDynamic(`audit.${row.action}`, undefined, t('audit.other'))}
              </span>
              <span className="text-xs text-muted-foreground">
                {t('place.historyBy', {
                  who: who(row.actor),
                  when: relativeTime(row.occurredAt, now, translator),
                })}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
