'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { adminUsersList, auditLogsActions, auditLogsList } from '@wayfare/api-client';
import type { AuditLogResponseDto, AuditLogsListParams } from '@wayfare/api-client';
import { AUDIT_RESOURCE_TYPES } from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { FilterButton, LoadMore, PageHeader, SearchField } from '@wayfare/ui/list';
import { Popover, PopoverContent, PopoverTrigger } from '@wayfare/ui/menu';
import { mergeCursorPages } from '@wayfare/ui/paging';
import { EmptyState } from '@wayfare/ui/states';
import { Skeleton } from '@wayfare/ui/surfaces';
import {
  Calendar,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  ScrollText,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Fragment, useState } from 'react';
import { failureOf } from '../client/errors';
import { ClearFilters, Filter } from '../components/filter';
import { DayInput, isDay } from '../forms/day-input';
import { formatDate, formatTime } from '../i18n/format';
import type { Translator } from '../i18n/messages';
import { useConsole } from '../i18n/provider';
import { useCan } from '../shell/can';
import { useMe } from '../shell/me';
import { ErrorView } from '../states/states';
import { dayRange, defaultDays, rangeError } from './audit-dates';

type Row = AuditLogResponseDto;
const PAGE_SIZE = 25;

/** Where a resource's own page is, by its type; `null` for one the console has no page for. */
export function resourceHref(type: string, id: string | null): string | null {
  if (id === null) return null;
  switch (type) {
    case 'USER':
      return `/users/${id}`;
    case 'PLACE':
      return `/places/${id}`;
    case 'AREA':
      return `/areas/${id}`;
    case 'ROLE':
      return `/roles/${id}`;
    case 'ACCOUNT_RECOVERY':
      return `/recoveries/${id}`;
    case 'SUBMISSION':
      return `/submissions/${id}`;
    case 'OWNER_REGISTRATION':
      return `/registrations/${id}`;
    case 'PRONUNCIATION':
      return `/narration/pronunciation/${id}`;
    case 'SYNTHESIS_JOB':
      return `/narration/jobs/${id}`;
    case 'CATEGORY':
      return '/categories';
    default:
      return null;
  }
}

/** A metadata value in words: dates as dates, lists joined, yes or no. */
function valueWords(value: unknown, { t, locale }: Translator): string {
  if (typeof value === 'boolean') return value ? t('auditValue.yes') : t('auditValue.no');
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value))
    return formatDate(value, locale);
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return value === null || value === undefined ? '—' : JSON.stringify(value);
}

/** A field's label: its own words, else its name spread out ("triggerRadiusM" → "Trigger radius m"). */
function fieldLabel(key: string, { tDynamic }: Translator): string {
  const spread = key.replaceAll(/([A-Z])/g, ' $1').toLowerCase();
  return tDynamic(`auditField.${key}`, undefined, spread.charAt(0).toUpperCase() + spread.slice(1));
}

/** A row's details (H2): the reason, then the allowlisted fields it kept — nothing more. */
export function detailLines(metadata: Row['metadata'], translator: Translator): [string, string][] {
  const lines: [string, string][] = [];
  if (typeof metadata.reason === 'string')
    lines.push([fieldLabel('reason', translator), metadata.reason]);
  for (const section of ['after', 'before'] as const) {
    const fields = metadata[section];
    if (typeof fields !== 'object' || fields === null) continue;
    for (const [key, value] of Object.entries(fields)) {
      const label = fieldLabel(key, translator);
      lines.push([
        section === 'before'
          ? `${label} (${translator.t('auditField.before').toLowerCase()})`
          : label,
        valueWords(value, translator),
      ]);
    }
  }
  return lines;
}

/**
 * The audit log (H1–H3): dates first and required, the last 7 days by default, at most 93 —
 * checked here before asking (K22); Who, Action and Resource; a record's filter from the URL as a
 * chip. Rows open in place with their details.
 */
export function AuditLog() {
  const translator = useConsole();
  const { t, tDynamic, locale } = translator;
  const can = useCan();
  const me = useMe();
  const router = useRouter();
  const path = usePathname();
  const search = useSearchParams();
  const record = {
    type: search.get('resourceType'),
    id: search.get('resourceId'),
  };
  const [days, setDays] = useState(defaultDays);
  const [who, setWho] = useState<{ id: string; name: string } | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [resource, setResource] = useState<string | null>(record.type);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const error = rangeError(days.from, days.to);
  const actions = useQuery({
    queryKey: ['audit-actions'],
    queryFn: async () => (await auditLogsActions()).data,
    staleTime: 30 * 60_000,
  });
  const params: AuditLogsListParams = {
    ...dayRange(days.from, days.to),
    limit: PAGE_SIZE,
    ...(who === null ? {} : { actorUserId: who.id }),
    ...(action === null ? {} : { action }),
    ...(resource === null ? {} : { resourceType: resource as AuditLogsListParams['resourceType'] }),
    ...(record.id === null ? {} : { resourceId: record.id }),
  };
  const list = useInfiniteQuery({
    queryKey: ['audit-log', params],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      auditLogsList({ ...params, ...(pageParam === undefined ? {} : { cursor: pageParam }) }),
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
    enabled: error === null,
  });
  const rows =
    list.data === undefined
      ? undefined
      : mergeCursorPages(list.data.pages.map((page) => page.data));
  const filtered = who !== null || action !== null || resource !== null || record.id !== null;
  const clear = () => {
    setWho(null);
    setAction(null);
    setResource(null);
    if (record.id !== null || record.type !== null) router.replace(path);
  };
  const toggle = (id: string) =>
    setOpen((now) => {
      const next = new Set(now);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const actorName = (row: Row) =>
    row.actor.type === 'SYSTEM' || row.actor.userId === null
      ? t('auditLog.system')
      : row.actor.userId === me.user.id
        ? t('history.you')
        : (row.actor.name ?? t('history.staff'));
  const actor = (row: Row) => {
    const automatic = row.actor.type === 'SYSTEM' || row.actor.userId === null;
    const name = actorName(row);
    return (
      <span className="flex flex-col">
        <span className="text-foreground">{name}</span>
        <span className="text-xs text-muted-foreground">
          {automatic
            ? t('auditLog.kind.automatic')
            : row.actor.kind === null
              ? ''
              : tDynamic(`auditLog.kind.${row.actor.kind}`)}
        </span>
      </span>
    );
  };
  const resourceCell = (row: Row) => {
    const type = tDynamic(`auditResource.${row.resource.type}`, undefined, row.resource.type);
    const text =
      row.resource.type === 'USER' && row.resource.label !== null
        ? t('auditLog.userResource', { name: row.resource.label })
        : type;
    const href = resourceHref(row.resource.type, row.resource.id);
    return href === null ? (
      <span>{text}</span>
    ) : (
      <Link href={href} className="font-medium text-primary hover:underline">
        {text}
      </Link>
    );
  };
  const when = (row: Row) => (
    <span className="flex flex-col whitespace-nowrap">
      <span className="text-foreground">{formatDate(row.occurredAt, locale)}</span>
      <span className="text-xs text-muted-foreground">{formatTime(row.occurredAt, locale)}</span>
    </span>
  );
  const actionCell = (row: Row) => (
    <span className="flex flex-col">
      <span className="font-medium text-foreground">
        {tDynamic(`auditAction.${row.action}`, undefined, row.action)}
      </span>
      <span className="font-mono text-xs text-muted-foreground">{row.action}</span>
    </span>
  );
  const details = (row: Row) => {
    const lines = detailLines(row.metadata, translator);
    return lines.length === 0 ? (
      <p className="text-sm text-muted-foreground">{t('auditLog.noDetails')}</p>
    ) : (
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        {lines.map(([label, value]) => (
          <Fragment key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-words text-foreground sm:col-span-3">{value}</dd>
          </Fragment>
        ))}
      </dl>
    );
  };
  const expander = (row: Row) => (
    <Button
      variant="ghost"
      size="icon"
      aria-expanded={open.has(row.id)}
      aria-controls={`audit-${row.id}`}
      aria-label={open.has(row.id) ? t('auditLog.hideDetails') : t('auditLog.showDetails')}
      onClick={() => toggle(row.id)}
    >
      {open.has(row.id) ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
    </Button>
  );

  return (
    <>
      <PageHeader title={t('auditLog.title')} description={t('auditLog.lead')} />
      <div className="flex flex-col gap-2">
        <span id="audit-dates" className="text-sm font-medium text-foreground">
          {t('auditLog.dates')}
          <span aria-hidden className="ml-1 text-destructive">
            *
          </span>
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <DatesField days={days} onChange={setDays} invalid={error !== null} />
          {can('user.read') ? <WhoFilter value={who} onChange={setWho} /> : null}
          <Filter
            name={t('auditLog.action')}
            allLabel={t('auditLog.all')}
            value={action}
            options={(actions.data ?? []).map((code) => ({
              value: code,
              label: tDynamic(`auditAction.${code}`, undefined, code),
            }))}
            onChange={setAction}
          />
          {record.id === null ? (
            <Filter
              name={t('auditLog.resource')}
              allLabel={t('auditLog.all')}
              value={resource}
              options={AUDIT_RESOURCE_TYPES.map((type) => ({
                value: type,
                label: tDynamic(`auditResource.${type}`, undefined, type),
              }))}
              onChange={setResource}
            />
          ) : (
            // H3: a record's own filter, from its *See all in the audit log*.
            <span className="inline-flex h-9 items-center gap-1 rounded-md border border-input bg-accent px-3 text-sm text-accent-foreground">
              {t('auditLog.thisRecord', {
                resource: tDynamic(
                  `auditResource.${record.type}`,
                  undefined,
                  t('auditLog.resource'),
                ),
              })}
              <button
                type="button"
                aria-label={t('auditLog.clearRecord')}
                onClick={() => router.replace(path)}
                className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X aria-hidden className="size-4" />
              </button>
            </span>
          )}
          {filtered ? <ClearFilters label={t('auditLog.clearFilters')} onClear={clear} /> : null}
        </div>
        {error === null ? null : (
          <p id="audit-dates-error" className="flex items-center gap-1 text-xs text-destructive">
            <CircleAlert aria-hidden className="size-3" />
            {error === 'tooLong' ? t('auditLog.tooLong') : t('auditLog.backwards')}
          </p>
        )}
      </div>
      {error !== null ? (
        <EmptyState
          icon={<Calendar />}
          title={t('auditLog.tooLongTitle')}
          body={t('auditLog.tooLongBody')}
        />
      ) : list.isError ? (
        <ErrorView failure={failureOf(list.error)} onRetry={() => void list.refetch()} />
      ) : rows !== undefined && rows.length === 0 ? (
        <EmptyState
          icon={<ScrollText />}
          title={t('auditLog.emptyTitle')}
          body={t('auditLog.emptyBody')}
          action={
            filtered ? (
              <Button variant="outline" onClick={clear}>
                {t('auditLog.clearFilters')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <table className="hidden w-full text-left text-sm md:table">
              <caption className="sr-only">{t('auditLog.title')}</caption>
              <thead className="bg-muted">
                <tr>
                  {[
                    t('auditLog.when'),
                    t('auditLog.who'),
                    t('auditLog.action'),
                    t('auditLog.resource'),
                  ].map((label) => (
                    <th
                      key={label}
                      scope="col"
                      className="px-4 py-3 font-medium text-muted-foreground"
                    >
                      {label}
                    </th>
                  ))}
                  <th scope="col" className="w-px px-4 py-3">
                    <span className="sr-only">{t('auditLog.rowActions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows === undefined
                  ? Array.from({ length: 6 }, (_, index) => (
                      <tr key={index} className="border-t border-border">
                        {Array.from({ length: 5 }, (__, cell) => (
                          <td key={cell} className="px-4 py-4">
                            <Skeleton className="h-4 w-3/4" />
                          </td>
                        ))}
                      </tr>
                    ))
                  : rows.map((row) => (
                      <Fragment key={row.id}>
                        <tr
                          className={`border-t border-border ${open.has(row.id) ? 'bg-accent' : ''}`}
                        >
                          <td className="px-4 py-3 align-middle">{when(row)}</td>
                          <td className="px-4 py-3 align-middle">{actor(row)}</td>
                          <td className="px-4 py-3 align-middle">{actionCell(row)}</td>
                          <td className="px-4 py-3 align-middle">{resourceCell(row)}</td>
                          <td className="px-4 py-3 align-middle">{expander(row)}</td>
                        </tr>
                        {open.has(row.id) ? (
                          <tr id={`audit-${row.id}`} className="bg-muted">
                            <td colSpan={5} className="px-6 py-4">
                              {details(row)}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))}
              </tbody>
            </table>
            <ul
              className="flex flex-col divide-y divide-border md:hidden"
              aria-label={t('auditLog.title')}
            >
              {(rows ?? []).map((row) => (
                <li key={row.id} className="flex flex-col gap-2 p-4">
                  <div className="flex items-start gap-2">
                    {/* The action, one facts line, the time (rounds 33–34's card). */}
                    <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                      <span className="font-medium text-foreground">
                        {tDynamic(`auditAction.${row.action}`, undefined, row.action)}
                      </span>
                      <p className="text-xs text-muted-foreground">
                        {resourceCell(row)} · {t('auditLog.byWho', { who: actorName(row) })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(row.occurredAt, locale)}, {formatTime(row.occurredAt, locale)}
                      </p>
                    </div>
                    {expander(row)}
                  </div>
                  {open.has(row.id) ? (
                    <div id={`audit-${row.id}`} className="rounded-md bg-muted p-3">
                      {details(row)}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
          {/* New rows after *Load more* are said politely (the handoff's §11). */}
          <p role="status" className="sr-only">
            {(list.data?.pages.length ?? 0) > 1
              ? t('auditLog.more', { count: list.data?.pages.at(-1)?.data.length ?? 0 })
              : ''}
          </p>
          {list.hasNextPage ? (
            <LoadMore
              label={t('auditLog.loadMore')}
              busy={list.isFetchingNextPage ? t('auditLog.loadMore') : undefined}
              onLoad={() => void list.fetchNextPage()}
            />
          ) : null}
        </>
      )}
    </>
  );
}

/** Dates (H1): the range on a button; two date fields in its popover. */
function DatesField({
  days,
  onChange,
  invalid,
}: {
  days: { from: string; to: string };
  onChange: (days: { from: string; to: string }) => void;
  invalid: boolean;
}) {
  const { t, locale } = useConsole();
  const [draft, setDraft] = useState(days);
  const [open, setOpen] = useState(false);
  const label = t('auditLog.range', {
    from: formatDate(`${days.from}T12:00:00`, locale),
    to: formatDate(`${days.to}T12:00:00`, locale),
  });
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setDraft(days);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-labelledby="audit-dates audit-dates-value"
          aria-describedby={invalid ? 'audit-dates-error' : undefined}
          aria-invalid={invalid || undefined}
          className={`inline-flex h-9 items-center gap-2 rounded-md border bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${invalid ? 'border-destructive' : 'border-input'}`}
        >
          <CalendarDays aria-hidden className="size-4 text-muted-foreground" />
          <span id="audit-dates-value" className="font-medium text-foreground">
            {label}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            // Applied once both read as days; the field marks the one that doesn't.
            if (!isDay(draft.from) || !isDay(draft.to)) return;
            onChange(draft);
            setOpen(false);
          }}
        >
          {(['from', 'to'] as const).map((end) => (
            <label key={end} className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">{t(`auditLog.${end}`)}</span>
              <DayInput
                required
                aria-invalid={draft[end] !== '' && !isDay(draft[end]) ? true : undefined}
                value={draft[end]}
                onChange={(day) => setDraft((now) => ({ ...now, [end]: day }))}
              />
            </label>
          ))}
          <Button type="submit" size="sm">
            {t('auditLog.apply')}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** Who (H1): a person found by name or email (`user.read`), or anyone. */
function WhoFilter({
  value,
  onChange,
}: {
  value: { id: string; name: string } | null;
  onChange: (value: { id: string; name: string } | null) => void;
}) {
  const { t } = useConsole();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const people = useQuery({
    queryKey: ['audit-who', query.trim()],
    queryFn: async () => (await adminUsersList({ q: query.trim(), pageSize: 8 })).data,
    enabled: open && query.trim().length > 0,
  });
  const pick = (next: { id: string; name: string } | null) => {
    onChange(next);
    setOpen(false);
    setQuery('');
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <FilterButton name={t('auditLog.who')} value={value?.name ?? t('auditLog.anyone')} />
      </PopoverTrigger>
      <PopoverContent>
        <div className="flex w-64 flex-col gap-2">
          <SearchField
            aria-label={t('auditLog.searchPeople')}
            placeholder={t('auditLog.searchPeople')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="md:w-full"
          />
          <ul className="flex flex-col">
            <li>
              <button
                type="button"
                className="w-full rounded-sm px-2 py-1 text-left text-sm hover:bg-muted"
                onClick={() => pick(null)}
              >
                {t('auditLog.anyone')}
              </button>
            </li>
            {(people.data ?? []).flatMap((person) =>
              person.erased
                ? []
                : [
                    <li key={person.id}>
                      <button
                        type="button"
                        className="flex w-full flex-col rounded-sm px-2 py-1 text-left text-sm hover:bg-muted"
                        onClick={() =>
                          pick({ id: person.id, name: person.fullName ?? person.email })
                        }
                      >
                        <span className="text-foreground">{person.fullName ?? person.email}</span>
                        <span className="text-xs text-muted-foreground">{person.email}</span>
                      </button>
                    </li>,
                  ],
            )}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}
