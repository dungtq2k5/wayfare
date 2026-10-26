'use client';

import type { SubmissionEditableField } from '@wayfare/contracts';
import { ChangeChip, WordDiffText } from '@wayfare/ui/content';
import { PlaceMap } from '@wayfare/ui/map';
import type { MapPoint } from '@wayfare/ui/map';
import { Card } from '@wayfare/ui/surfaces';
import { wordDiff } from '@wayfare/ui/word-diff';
import { cn } from '@wayfare/ui/cn';
import { ImageOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { useConsole } from '../i18n/provider';
import { formatPhone } from '../i18n/format';
import { pinMove } from './geo';
import { Facts, HoursList } from './place-sections';
import type { PlaceDetail } from './place-types';
import { useNames } from './reference';

/** One column of a field's card: *When sent*, *Now* or *Proposed*, and its value. */
export interface DiffColumn {
  readonly label: string;
  readonly value: unknown;
}

interface HoursRow {
  weekday: number | null;
  specificDate: string | null;
  opensAt: string | null;
  closesAt: string | null;
  isClosed: boolean;
}
interface PhotoItem {
  photoId?: string;
  uploadId?: string;
  altTextVi: string | null;
}
interface Dish {
  nameVi: string;
  priceMinor: number | null;
}

/** Where a photo's thumbnail is: a kept photo's from the live Place, a new one's from its upload. */
export type PhotoSource = (photo: PhotoItem) => string | undefined;

const TEXT_FIELDS = new Set<SubmissionEditableField>(['nameVi', 'descriptionVi']);
const photoKey = (photo: PhotoItem) => photo.photoId ?? photo.uploadId ?? '';
const hoursKey = (row: HoursRow) => row.specificDate ?? `w${row.weekday ?? 0}`;

/**
 * A field's card (S2, S3): its columns side by side — text by words, struck and underlined so
 * colour is never the only signal; photos, hours and the menu item by item with their change
 * marked; the location as maps with the move said in words. A field someone else changed since
 * gains its third column and the *Changed since sent* chip.
 */
export function FieldCard({
  field,
  columns,
  conflict,
  photoSource,
  mapStyle,
  note,
}: {
  field: SubmissionEditableField;
  columns: readonly DiffColumn[];
  conflict: boolean;
  photoSource: PhotoSource;
  mapStyle: string | null;
  note?: ReactNode;
}) {
  const { t, tDynamic } = useConsole();
  const heading = tDynamic(`field.${field}`);
  return (
    <Card
      className={cn(
        'flex flex-col gap-3',
        columns.length === 1 && '[&_[data-column-label]]:sr-only',
      )}
      aria-label={heading}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground first-letter:uppercase">
          {heading}
        </h2>
        {conflict ? (
          <ChangeChip change="conflict">{t('change.conflict')}</ChangeChip>
        ) : columns.length > 1 ? (
          <ChangeChip change="changed">{t('change.changed')}</ChangeChip>
        ) : null}
      </div>
      <FieldBody field={field} columns={columns} photoSource={photoSource} mapStyle={mapStyle} />
      {note === undefined ? null : <p className="text-xs text-muted-foreground">{note}</p>}
    </Card>
  );
}

function FieldBody({
  field,
  columns,
  photoSource,
  mapStyle,
}: {
  field: SubmissionEditableField;
  columns: readonly DiffColumn[];
  photoSource: PhotoSource;
  mapStyle: string | null;
}) {
  switch (field) {
    case 'openingHours':
      // With nothing to compare, the hours as a Place's page lists them.
      return columns.length === 1 ? (
        <HoursList rows={(columns[0]!.value as PlaceDetail['openingHours'] | null) ?? []} />
      ) : (
        <HoursDiff columns={columns} />
      );
    case 'menu':
      return <MenuDiff columns={columns} />;
    case 'photos':
      return <PhotosDiff columns={columns} photoSource={photoSource} />;
    case 'location':
      return <LocationDiff columns={columns} mapStyle={mapStyle} />;
    default:
      return <ValueColumns field={field} columns={columns} />;
  }
}

function Grid({ count, children }: { count: number; children: ReactNode }) {
  const cols = count === 3 ? 'md:grid-cols-3' : count === 2 ? 'md:grid-cols-2' : '';
  return <div className={`grid grid-cols-1 gap-4 ${cols}`}>{children}</div>;
}

/** A column's label; a card with one column (a new venue's) keeps it for readers only. */
function ColumnLabel({ children }: { children: ReactNode }) {
  return (
    <p data-column-label className="mb-1 text-xs text-muted-foreground">
      {children}
    </p>
  );
}

/** The fields a new venue's Details card holds, in its order. */
const DETAIL_FIELDS = [
  'nameVi',
  'categoryCode',
  'addressVi',
  'descriptionVi',
  'priceBand',
  'phone',
  'websiteUrl',
] as const satisfies readonly SubmissionEditableField[];

/**
 * A new venue's proposal (S6): with nothing to compare, its plain fields as one Details card of
 * labels and values; location, hours, menu and photos keep their own cards.
 */
export function ProposalDetails({
  payload,
}: {
  payload: Readonly<Partial<Record<SubmissionEditableField, unknown>>>;
}) {
  const { t, tDynamic } = useConsole();
  const text = useValueText();
  return (
    <Card className="flex flex-col gap-3" aria-labelledby="proposal-details">
      <h2 id="proposal-details" className="text-base font-semibold text-foreground">
        {t('place.details')}
      </h2>
      <Facts
        rows={DETAIL_FIELDS.map((field) => [
          upperFirst(tDynamic(`field.${field}`)),
          <span key={field} lang="vi" className="whitespace-pre-wrap">
            {text(field, payload[field])}
          </span>,
        ])}
      />
    </Card>
  );
}

const upperFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** How a plain field's value reads: a category's name, a price band, a phone in groups. */
function useValueText(): (field: SubmissionEditableField, value: unknown) => string {
  const { t } = useConsole();
  const names = useNames();
  // These fields hold a string or a number (the price band), never an object.
  return (field, value) => {
    if (typeof value !== 'string' && typeof value !== 'number') return t('place.none');
    if (value === '') return t('place.none');
    if (field === 'categoryCode') return names.category(String(value));
    if (field === 'priceBand') return t('place.priceBand', { band: Number(value) });
    if (field === 'phone') return formatPhone(String(value));
    return String(value);
  };
}

/** Text, a category, a price band, an address, a phone or a website. */
function ValueColumns({
  field,
  columns,
}: {
  field: SubmissionEditableField;
  columns: readonly DiffColumn[];
}) {
  const valueText = useValueText();
  const text = (value: unknown) => valueText(field, value);
  const proposed = columns.at(-1)!;
  const compared = columns.length > 1 ? columns.at(-2)! : null;
  const runs =
    compared !== null && TEXT_FIELDS.has(field)
      ? wordDiff(text(compared.value), text(proposed.value))
      : null;
  return (
    <Grid count={columns.length}>
      {columns.map((column, index) => {
        const last = index === columns.length - 1;
        const diffed = runs !== null && (last || column === compared);
        return (
          <div key={column.label} lang="vi" className="text-sm text-foreground">
            <ColumnLabel>{column.label}</ColumnLabel>
            {diffed ? (
              <WordDiffText runs={runs} side={last ? 'after' : 'before'} />
            ) : (
              <span className={last && columns.length > 1 ? 'font-medium' : undefined}>
                {text(column.value)}
              </span>
            )}
          </div>
        );
      })}
    </Grid>
  );
}

function PhotosDiff({
  columns,
  photoSource,
}: {
  columns: readonly DiffColumn[];
  photoSource: PhotoSource;
}) {
  const { t } = useConsole();
  const sets = columns.map((column) => (column.value as PhotoItem[] | null) ?? []);
  const proposed = new Set(sets.at(-1)!.map(photoKey));
  const now = new Set((sets.length > 1 ? sets.at(-2)! : []).map(photoKey));
  return (
    <Grid count={columns.length}>
      {columns.map((column, index) => {
        const last = index === columns.length - 1;
        return (
          <div key={column.label}>
            <ColumnLabel>
              {column.label} · {sets[index]!.length}
            </ColumnLabel>
            <ul className="flex flex-wrap gap-2">
              {sets[index]!.map((photo) => {
                const url = photoSource(photo);
                const chip =
                  columns.length === 1 ? null : last && !now.has(photoKey(photo)) ? (
                    <ChangeChip change="added">{t('change.added')}</ChangeChip>
                  ) : !last && index === columns.length - 2 && !proposed.has(photoKey(photo)) ? (
                    <ChangeChip change="removed">{t('change.removed')}</ChangeChip>
                  ) : null;
                return (
                  <li key={photoKey(photo)} className="flex w-24 flex-col items-start gap-1">
                    {url === undefined ? (
                      <span className="flex h-16 w-24 items-center justify-center rounded-md bg-muted">
                        <ImageOff aria-hidden className="size-5 text-muted-foreground" />
                      </span>
                    ) : (
                      <img
                        src={url}
                        alt={photo.altTextVi ?? ''}
                        className="h-16 w-24 rounded-md object-cover"
                      />
                    )}
                    {chip}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </Grid>
  );
}

function HoursDiff({ columns }: { columns: readonly DiffColumn[] }) {
  const { t } = useConsole();
  const sets = columns.map(
    (column) =>
      new Map(((column.value as HoursRow[] | null) ?? []).map((row) => [hoursKey(row), row])),
  );
  // Weekdays first (w1–w7), then special dates in order.
  const keys = [...new Set(sets.flatMap((set) => [...set.keys()]))].sort((a, b) =>
    a[0] === b[0] ? a.localeCompare(b) : a.startsWith('w') ? -1 : 1,
  );
  const cell = (row: HoursRow | undefined) =>
    row === undefined
      ? t('place.none')
      : row.isClosed
        ? t('place.closed')
        : `${row.opensAt ?? ''}–${row.closesAt ?? ''}`;
  const day = (key: string) =>
    key.startsWith('w') ? t('place.weekday', { day: key.slice(1) }) : key;
  return (
    <div
      className="relative overflow-x-auto"
      role="region"
      aria-label={t('a11y.table', { name: t('placeForm.hours') })}
      tabIndex={0}
    >
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="py-1 pr-4 font-normal">
              {t('submission.day')}
            </th>
            {columns.map((column) => (
              <th
                key={column.label}
                scope="col"
                data-column-label
                className="py-1 pr-4 font-normal"
              >
                {column.label}
              </th>
            ))}
            <th scope="col" className="py-1 font-normal">
              <span className="sr-only">{t('submission.change')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => {
            const values = sets.map((set) => cell(set.get(key)));
            const changed = columns.length > 1 && values.at(-1) !== values.at(-2);
            return (
              <tr key={key} className="border-t border-border">
                <th scope="row" className="py-2 pr-4 font-normal text-foreground">
                  {day(key)}
                </th>
                {values.map((value, index) => (
                  <td
                    key={columns[index]!.label}
                    className={
                      changed && index === values.length - 1
                        ? 'py-2 pr-4 font-medium text-success-foreground'
                        : 'py-2 pr-4'
                    }
                  >
                    {value}
                  </td>
                ))}
                <td className="py-2">
                  {changed ? <ChangeChip change="changed">{t('change.changed')}</ChangeChip> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MenuDiff({ columns }: { columns: readonly DiffColumn[] }) {
  const { t } = useConsole();
  const dishes = (value: unknown) =>
    new Map(((value as { items?: Dish[] } | null)?.items ?? []).map((dish) => [dish.nameVi, dish]));
  const before = columns.length > 1 ? dishes(columns.at(-2)!.value) : new Map<string, Dish>();
  const after = dishes(columns.at(-1)!.value);
  const names = [...new Set([...before.keys(), ...after.keys()])];
  const price = (dish: Dish | undefined) =>
    dish === undefined
      ? t('place.none')
      : dish.priceMinor === null
        ? t('place.none')
        : `${dish.priceMinor.toLocaleString('vi-VN')} ₫`;
  return (
    <ul className="flex flex-col divide-y divide-border text-sm">
      {names.map((name) => {
        const was = before.get(name);
        const now = after.get(name);
        const change =
          columns.length === 1
            ? null
            : was === undefined
              ? 'added'
              : now === undefined
                ? 'removed'
                : was.priceMinor !== now.priceMinor
                  ? 'changed'
                  : null;
        return (
          <li key={name} className="flex flex-wrap items-center gap-3 py-2">
            <span lang="vi" className="min-w-40 flex-1 text-foreground">
              {name}
            </span>
            {columns.length > 1 ? (
              <>
                <span
                  className={
                    change === null ? 'text-muted-foreground' : 'text-muted-foreground line-through'
                  }
                >
                  {price(was)}
                </span>
                {/* From and to read without colour. */}
                <span aria-hidden className="text-muted-foreground">
                  ›
                </span>
              </>
            ) : null}
            <span className="font-medium text-foreground">{price(now)}</span>
            {change === null ? null : (
              <ChangeChip change={change}>{t(`change.${change}`)}</ChangeChip>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function LocationDiff({
  columns,
  mapStyle,
}: {
  columns: readonly DiffColumn[];
  mapStyle: string | null;
}) {
  const { t, tDynamic } = useConsole();
  const points = columns.map((column) => column.value as MapPoint);
  const move = points.length > 1 ? pinMove(points.at(-2)!, points.at(-1)!) : null;
  return (
    <>
      <Grid count={columns.length}>
        {columns.map((column, index) => {
          const point = points[index]!;
          const coordinates = `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
          return (
            <div key={column.label} className="flex flex-col gap-1">
              <ColumnLabel>
                {column.label} · {coordinates}
              </ColumnLabel>
              {mapStyle === null ? null : (
                <PlaceMap
                  style={mapStyle}
                  center={point}
                  label={`${column.label}: ${coordinates}`}
                  className="h-48"
                />
              )}
            </div>
          );
        })}
      </Grid>
      {move === null ? null : (
        <p className="text-sm text-foreground">
          {t('submission.pinMoves', {
            m: move.metres,
            direction: tDynamic(`direction.${move.direction}`),
          })}
        </p>
      )}
    </>
  );
}
