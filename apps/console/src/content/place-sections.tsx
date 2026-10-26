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

/**
 * A card with its title and, for someone who may, its *Edit* (a link, or `action`). Its heading
 * takes focus when a link brings the reader to it (`focusSection`).
 */
export function Section({
  id,
  title,
  edit,
  action,
  children,
}: {
  id: string;
  title: string;
  edit?: { href: string; label: string } | undefined;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-4" aria-labelledby={id}>
      <div className="flex items-center justify-between gap-2">
        <h2
          id={id}
          tabIndex={-1}
          className="rounded-sm text-lg font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {title}
        </h2>
        {action}
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

/** Scrolls to a section and moves focus to its heading, so the reader's place moves with it. */
export function focusSection(id: string): void {
  const heading = document.getElementById(id);
  if (heading === null) return;
  heading.scrollIntoView({ block: 'start' });
  heading.focus({ preventScroll: true });
}

/**
 * Label and value rows, as Details and Facts set them out. `fit`: the label column as wide as its
 * longest label, for a narrow side card.
 */
export function Facts({
  rows,
  fit = false,
}: {
  rows: readonly (readonly [string, ReactNode])[];
  fit?: boolean;
}) {
  if (fit) {
    // A table sizes the label column to its longest label.
    return (
      <dl className="table w-full text-sm">
        {rows.map(([term, value]) => (
          <div key={term} className="table-row">
            <dt className="table-cell py-1 pr-6 whitespace-nowrap text-muted-foreground">{term}</dt>
            <dd className="table-cell py-1 text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    );
  }
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

/**
 * Opening hours as the page shows them: the week first, days in a row with the same hours as one
 * line ("Mon–Sat"), then the special dates.
 */
export function HoursList({ rows }: { rows: PlaceDetail['openingHours'] }) {
  const { t, locale } = useConsole();
  if (rows.length === 0)
    return <p className="text-sm text-muted-foreground">{t('place.noHours')}</p>;
  const value = (row: PlaceDetail['openingHours'][number]) =>
    row.isClosed ? t('place.closed') : `${row.opensAt ?? ''}–${row.closesAt ?? ''}`;
  // A weekly row has no `specificDate` at all (undefined), a special one a date.
  const weekly = rows
    .filter((row) => row.specificDate == null)
    .sort((a, b) => (a.weekday ?? 0) - (b.weekday ?? 0));
  const special = rows.filter((row) => row.specificDate != null);
  const runs: { from: number; to: number; value: string }[] = [];
  for (const row of weekly) {
    const last = runs.at(-1);
    if (last !== undefined && last.to === (row.weekday ?? 0) - 1 && last.value === value(row))
      last.to = row.weekday ?? 0;
    else runs.push({ from: row.weekday ?? 0, to: row.weekday ?? 0, value: value(row) });
  }
  const day = (weekday: number) => t('place.weekday', { day: String(weekday) });
  const short = (weekday: number) => t('place.weekdayShort', { day: String(weekday) });
  const dayMonth = (date: string) =>
    new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(new Date(`${date}T00:00:00Z`));
  return (
    <Facts
      rows={[
        ...runs.map(
          (run) =>
            [
              run.from === 1 && run.to === 7
                ? t('place.everyDay')
                : run.from === run.to
                  ? day(run.from)
                  : `${short(run.from)}–${short(run.to)}`,
              run.value,
            ] as const,
        ),
        ...special.map(
          (row) =>
            [`${t('place.specialDates')} · ${dayMonth(row.specificDate!)}`, value(row)] as const,
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
        // A minute early: the creation's audit row takes catalog's clock, `createdAt` the
        // database's, and the first may be a little earlier.
        from: new Date(Date.parse(place.createdAt) - 60_000).toISOString(),
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
