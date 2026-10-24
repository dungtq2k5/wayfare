'use client';

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
} from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { Button } from './button';
import { cn } from './cn';
import { Skeleton } from './surfaces';
import { pageCount, pageNumbers, pageRange } from './paging';

/** A list's column (P1): its label, and whether it sorts. */
export interface Column {
  readonly key: string;
  readonly label: string;
  readonly sortable?: boolean;
  /** Visually hidden header, for a column of row actions. */
  readonly hiddenLabel?: boolean;
  readonly className?: string;
}

export interface Sort {
  readonly key: string;
  readonly direction: 'ascending' | 'descending';
}

/**
 * The list page's table, and its cards below 768 px (round 33's rule: a table never scrolls
 * sideways). `rows` undefined is a first load: the header at once, skeleton rows under it.
 */
export function DataList<T>({
  caption,
  columns,
  rows,
  rowKey,
  cell,
  card,
  sort,
  onSort,
  skeletonRows = 6,
  rowClassName,
}: {
  caption: string;
  columns: readonly Column[];
  rows: readonly T[] | undefined;
  rowKey: (row: T) => string;
  cell: (row: T, column: string) => ReactNode;
  card: (row: T) => ReactNode;
  sort?: Sort | undefined;
  onSort?: (sort: Sort) => void;
  skeletonRows?: number;
  /** A row's own class: a row that just changed takes the accent fill, which fades (round 33). */
  rowClassName?: (row: T) => string | undefined;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <table className="hidden w-full text-left text-sm md:table">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted">
          <tr>
            {columns.map((column) => (
              <HeaderCell key={column.key} column={column} sort={sort} onSort={onSort} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows === undefined
            ? Array.from({ length: skeletonRows }, (_, index) => (
                <tr key={index} className="border-t border-border">
                  {columns.map((column) => (
                    <td key={column.key} className="px-4 py-4">
                      <Skeleton className="h-4 w-3/4" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row) => (
                <tr key={rowKey(row)} className={cn('border-t border-border', rowClassName?.(row))}>
                  {columns.map((column) => (
                    <td key={column.key} className={cn('px-4 py-3 align-middle', column.className)}>
                      {cell(row, column.key)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
      <ul className="flex flex-col divide-y divide-border md:hidden" aria-label={caption}>
        {rows === undefined
          ? Array.from({ length: 3 }, (_, index) => (
              <li key={index} className="flex flex-col gap-2 p-4">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-3/4" />
              </li>
            ))
          : rows.map((row) => (
              <li key={rowKey(row)} className={cn('p-4', rowClassName?.(row))}>
                {card(row)}
              </li>
            ))}
      </ul>
    </div>
  );
}

function HeaderCell({
  column,
  sort,
  onSort,
}: {
  column: Column;
  sort: Sort | undefined;
  onSort: ((sort: Sort) => void) | undefined;
}) {
  const active = sort?.key === column.key;
  const label =
    column.hiddenLabel === true ? <span className="sr-only">{column.label}</span> : column.label;
  if (column.sortable !== true || onSort === undefined) {
    // A fixed order (a queue's oldest first) is still announced on its column.
    return (
      <th
        scope="col"
        aria-sort={active ? sort.direction : undefined}
        className="px-4 py-3 font-medium text-muted-foreground"
      >
        {label}
      </th>
    );
  }
  const Icon = !active ? ArrowUpDown : sort.direction === 'ascending' ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={active ? sort.direction : 'none'}
      className={cn('px-4 py-3 font-medium', active ? 'text-foreground' : 'text-muted-foreground')}
    >
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() =>
          onSort({
            key: column.key,
            direction: active && sort.direction === 'descending' ? 'ascending' : 'descending',
          })
        }
      >
        {label}
        <Icon aria-hidden className="size-3" />
      </button>
    </th>
  );
}

/** Pages (P1): the range and total, then previous, the numbers and next; below 768 px no numbers. */
export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  labels,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  labels: {
    range: (range: { from: number; to: number; total: number }) => string;
    previous: string;
    next: string;
    page: (page: number) => string;
  };
}) {
  const pages = pageCount(total, pageSize);
  return (
    <nav
      aria-label={labels.range({ ...pageRange(page, pageSize, total), total })}
      className="flex items-center justify-between gap-4 text-sm"
    >
      <p className="text-muted-foreground">
        {labels.range({ ...pageRange(page, pageSize, total), total })}
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label={labels.previous}
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft aria-hidden />
        </Button>
        {pageNumbers(page, pages).map((slot, index) =>
          slot === 'gap' ? (
            <span
              key={`gap-${index}`}
              aria-hidden
              className="hidden px-2 text-muted-foreground md:inline"
            >
              …
            </span>
          ) : (
            <Button
              key={slot}
              variant={slot === page ? 'outline' : 'ghost'}
              size="icon"
              className="hidden md:inline-flex"
              aria-label={labels.page(slot)}
              aria-current={slot === page ? 'page' : undefined}
              onClick={() => onPage(slot)}
            >
              {slot}
            </Button>
          ),
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label={labels.next}
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </nav>
  );
}

/** A cursor (P1d): newest first, *Load more* under the list, no total. */
export function LoadMore({
  label,
  busy,
  onLoad,
}: {
  label: string;
  busy?: string | undefined;
  onLoad: () => void;
}) {
  return (
    <div className="flex justify-center">
      <Button variant="outline" busy={busy} onClick={onLoad}>
        {label}
      </Button>
    </div>
  );
}

/** The search field: 36 px, with the search icon; it fills the width below 768 px. */
export function SearchField({
  className,
  ...props
}: Omit<ComponentProps<'input'>, 'type'> & { 'aria-label': string }) {
  return (
    <div className={cn('relative w-full md:w-72', className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="search"
        className="h-9 w-full rounded-md border border-input bg-background pr-3 pl-9 text-sm text-foreground placeholder:text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        {...props}
      />
    </div>
  );
}

/** A filter's button: its name, its value and a chevron; it opens a menu of values. */
export function FilterButton({
  name,
  value,
  ...props
}: ComponentProps<'button'> & { name: string; value: string }) {
  return (
    <button
      type="button"
      className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      {...props}
    >
      <span className="text-muted-foreground">{name}</span>
      <span className="font-medium text-foreground">{value}</span>
      <ChevronDown aria-hidden className="size-4 text-muted-foreground" />
    </button>
  );
}

/** A page's title block: the title, its line, and its primary action for someone who may take it. */
export function PageHeader({
  title,
  description,
  action,
  breadcrumb,
  badges,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  breadcrumb?: ReactNode;
  /** Chips beside the title: a kind, a status. */
  badges?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        {breadcrumb}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
          {badges}
        </div>
        {description === undefined ? null : (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </header>
  );
}
