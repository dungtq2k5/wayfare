'use client';

import { MAX_PHOTOS_PER_PLACE } from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { Progress } from '@wayfare/ui/content';
import { Field, FieldError, Input, Select } from '@wayfare/ui/field';
import { ArrowDown, ArrowUp, Plus, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { DayInput } from '../forms/day-input';
import { useConsole } from '../i18n/provider';
import { UploadRefused, uploadPhoto } from './uploads';
import type { FormPhoto } from './uploads';

/** A file on its way, or refused (F4): its row until it lands or is removed. */
interface FileRow {
  readonly key: string;
  readonly name: string;
  readonly percent: number;
  readonly failure: string | null;
}

/**
 * Photos (L4): up to 8 with their alt text, ordered — the first is the cover. Each file is
 * uploaded and confirmed as it is added; a refusal is said under the section. For an owner (F3,
 * F4): the plan's own number, a box in the uploader's place once it is reached, and one row per
 * file with its progress or why it was refused.
 */
export function PhotosEditor({
  photos,
  onChange,
  error,
  max = MAX_PHOTOS_PER_PLACE,
  atMax,
  help,
  altPlaceholder,
  fileRows = false,
}: {
  photos: readonly FormPhoto[];
  onChange: (photos: FormPhoto[]) => void;
  error?: string | undefined;
  max?: number;
  /** What shows instead of the uploader once `max` is reached. */
  atMax?: ReactNode;
  help?: string;
  /** An owner's example for the alt text. */
  altPlaceholder?: string;
  fileRows?: boolean;
}) {
  const { t, tDynamic } = useConsole();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [rows, setRows] = useState<FileRow[]>([]);
  const patchRow = (key: string, patch: Partial<FileRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const failureText = (failure: unknown) =>
    failure instanceof UploadRefused
      ? tDynamic(
          `upload.${failure.code}`,
          failure.details,
          tDynamic(`error.${failure.code}`, failure.details),
        )
      : t('upload.UPLOAD_NOT_READY');
  // Refs, not state: a batch of files is added one await after another, before React re-renders.
  const latest = useRef(photos);
  latest.current = photos;
  const inFlight = useRef(0);

  const add = async (files: FileList | null) => {
    if (files === null) return;
    setRefusal(null);
    const chosen = Array.from(files);
    const room = Math.max(0, max - latest.current.length - inFlight.current);
    // An owner's plan says its own number in the box that replaces the uploader (F3).
    if (chosen.length > room && atMax === undefined) setRefusal(t('placeForm.tooManyPhotos'));
    for (const file of chosen.slice(0, room)) {
      inFlight.current += 1;
      setUploading(inFlight.current);
      const key = rowKey();
      if (fileRows)
        setRows((current) => [...current, { key, name: file.name, percent: 0, failure: null }]);
      try {
        const photo = await uploadPhoto(file, (percent) => fileRows && patchRow(key, { percent }));
        const next = [...latest.current, photo];
        latest.current = next;
        onChange(next);
        if (fileRows) setRows((current) => current.filter((row) => row.key !== key));
      } catch (failure) {
        if (fileRows) patchRow(key, { failure: failureText(failure) });
        else
          setRefusal(
            failure instanceof UploadRefused
              ? tDynamic(`error.${failure.code}`, failure.details)
              : t('error.UPLOAD_NOT_READY'),
          );
      } finally {
        inFlight.current -= 1;
        setUploading(inFlight.current);
      }
    }
  };
  const move = (index: number, by: -1 | 1) => {
    const next = [...photos];
    const [photo] = next.splice(index, 1);
    next.splice(index + by, 0, photo!);
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-3">
      {photos.length === 0 ? null : (
        <ol className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {photos.map((photo, index) => (
            <li key={photo.key} className="flex flex-col gap-2">
              <div className="relative">
                <img
                  src={photo.preview}
                  alt=""
                  className="aspect-video w-full rounded-md object-cover"
                />
                {index === 0 ? (
                  <span className="absolute top-2 left-2 rounded-full bg-card px-2 text-xs font-medium text-foreground">
                    {t('placeForm.cover')}
                  </span>
                ) : null}
              </div>
              <Field label={`${t('placeForm.altText')} · ${index + 1}`}>
                {(control) => (
                  <Input
                    {...control}
                    placeholder={altPlaceholder ?? t('placeForm.altTextPlaceholder')}
                    value={photo.altTextVi}
                    onChange={(event) =>
                      onChange(
                        photos.map((item) =>
                          item.key === photo.key
                            ? { ...item, altTextVi: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                )}
              </Field>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={index === 0}
                  aria-label={t('placeForm.moveEarlier', { n: index + 1 })}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={index === photos.length - 1}
                  aria-label={t('placeForm.moveLater', { n: index + 1 })}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('placeForm.removePhoto', { n: index + 1 })}
                  onClick={() => onChange(photos.filter((item) => item.key !== photo.key))}
                >
                  <X aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {rows.length === 0 ? null : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.key}
              className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm ${
                row.failure === null ? 'border-border' : 'border-destructive'
              }`}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate font-medium text-foreground">{row.name}</span>
                {row.failure === null ? (
                  <span role="status">
                    <Progress
                      value={row.percent}
                      max={100}
                      label={t('upload.uploading', { n: row.percent })}
                    />
                  </span>
                ) : (
                  <FieldError>{row.failure}</FieldError>
                )}
              </span>
              {row.failure === null ? null : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('upload.remove', { name: row.name })}
                  onClick={() =>
                    setRows((current) => current.filter((item) => item.key !== row.key))
                  }
                >
                  <X aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {atMax !== undefined && photos.length >= max ? (
        atMax
      ) : (
        <>
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void add(event.dataTransfer.files);
            }}
            className="flex flex-col items-center gap-2 rounded-md border-2 border-dashed border-input px-4 py-8 text-sm text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Upload aria-hidden className="size-5" />
            {uploading > 0 ? t('placeForm.uploading') : t('placeForm.dropPhoto')}
          </button>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            aria-label={t('placeForm.addPhoto')}
            onChange={(event) => {
              void add(event.target.files);
              event.target.value = '';
            }}
          />
        </>
      )}
      <p className="text-xs text-muted-foreground">
        {help ?? t('placeForm.photoHelp', { count: photos.length })}
      </p>
      {(refusal ?? error) ? (
        <p role="alert" className="text-sm text-destructive">
          {refusal ?? error}
        </p>
      ) : null}
    </div>
  );
}

/** An opening-hours row as the form holds it: a weekday or a date, the times or closed. */
export interface HoursRow {
  key: string;
  weekday: number | null;
  date: string | null;
  opensAt: string;
  closesAt: string;
  closed: boolean;
}

let counter = 0;
export const rowKey = () => `row-${++counter}`;

/** Opening hours (L4): one row a day or special date; closing after midnight is the same night. */
export function HoursEditor({
  rows,
  onChange,
}: {
  rows: readonly HoursRow[];
  onChange: (rows: HoursRow[]) => void;
}) {
  const { t } = useConsole();
  const set = (key: string, patch: Partial<HoursRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <div key={row.key} className="flex flex-wrap items-end gap-3">
          {row.date === null ? (
            <Field label={t('placeForm.days')} className="w-40">
              {(control) => (
                <Select
                  {...control}
                  value={row.weekday ?? 1}
                  onChange={(event) => set(row.key, { weekday: Number(event.target.value) })}
                >
                  {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                    <option key={day} value={day}>
                      {t('place.weekday', { day: String(day) })}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : (
            <Field label={t('placeForm.date')} className="w-40">
              {(control) => (
                <DayInput
                  {...control}
                  value={row.date ?? ''}
                  onChange={(day) => set(row.key, { date: day })}
                />
              )}
            </Field>
          )}
          <Field label={t('placeForm.opens')} className="w-28">
            {(control) => (
              <Input
                {...control}
                // A text field, not type="time": that one follows the browser's locale (AM and PM).
                inputMode="numeric"
                placeholder="HH:MM"
                pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
                maxLength={5}
                disabled={row.closed}
                value={row.opensAt}
                onChange={(event) => set(row.key, { opensAt: event.target.value })}
              />
            )}
          </Field>
          <Field label={t('placeForm.closes')} className="w-28">
            {(control) => (
              <Input
                {...control}
                inputMode="numeric"
                placeholder="HH:MM"
                pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
                maxLength={5}
                disabled={row.closed}
                value={row.closesAt}
                onChange={(event) => set(row.key, { closesAt: event.target.value })}
              />
            )}
          </Field>
          <label className="flex h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={row.closed}
              onChange={(event) => set(row.key, { closed: event.target.checked })}
            />
            {t('placeForm.closedAllDay')}
          </label>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('placeForm.removeRow')}
            onClick={() => onChange(rows.filter((item) => item.key !== row.key))}
          >
            <X aria-hidden />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange([
              ...rows,
              {
                key: rowKey(),
                weekday: 1,
                date: null,
                opensAt: '08:00',
                closesAt: '17:00',
                closed: false,
              },
            ])
          }
        >
          <Plus aria-hidden />
          {t('placeForm.addHours')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange([
              ...rows,
              {
                key: rowKey(),
                weekday: null,
                date: new Date().toISOString().slice(0, 10),
                opensAt: '',
                closesAt: '',
                closed: true,
              },
            ])
          }
        >
          <Plus aria-hidden />
          {t('placeForm.addDate')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('placeForm.midnight')}</p>
    </div>
  );
}

/** A menu dish as the form holds it. */
export interface DishRow {
  key: string;
  nameVi: string;
  price: string;
  isAvailable: boolean;
  /** The dish's description, kept as it is: the form doesn't edit it. */
  descriptionVi?: string | null;
}

/** The menu (L5, Venues only): dishes in Vietnamese with their prices. */
export function MenuEditor({
  rows,
  onChange,
  max,
  atMax,
  copy,
}: {
  rows: readonly DishRow[];
  onChange: (rows: DishRow[]) => void;
  /** The plan's dish limit (F3): *Add a dish* is disabled at it, with `atMax` said. */
  max?: number;
  atMax?: string;
  /** An owner's labels: the price in the menu's own currency, with their examples. */
  copy?: { price: string; dishPlaceholder: string; pricePlaceholder: string };
}) {
  const full = max !== undefined && rows.length >= max;
  const { t } = useConsole();
  const set = (key: string, patch: Partial<DishRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <div key={row.key} className="flex flex-wrap items-end gap-3">
          <Field label={t('placeForm.dish')} required className="min-w-48 flex-1">
            {(control) => (
              <Input
                {...control}
                placeholder={copy?.dishPlaceholder ?? t('placeForm.dishPlaceholder')}
                value={row.nameVi}
                onChange={(event) => set(row.key, { nameVi: event.target.value })}
              />
            )}
          </Field>
          <Field label={copy?.price ?? t('placeForm.dishPrice')} required className="w-32">
            {(control) => (
              <Input
                {...control}
                placeholder={copy?.pricePlaceholder ?? t('placeForm.pricePlaceholder')}
                inputMode="numeric"
                value={row.price}
                onChange={(event) => set(row.key, { price: event.target.value.replace(/\D/g, '') })}
              />
            )}
          </Field>
          <label className="flex h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={!row.isAvailable}
              onChange={(event) => set(row.key, { isAvailable: !event.target.checked })}
            />
            {t('place.unavailable')}
          </label>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('placeForm.removeDish')}
            onClick={() => onChange(rows.filter((item) => item.key !== row.key))}
          >
            <X aria-hidden />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start"
        disabled={full}
        onClick={() =>
          onChange([...rows, { key: rowKey(), nameVi: '', price: '', isAvailable: true }])
        }
      >
        <Plus aria-hidden />
        {t('placeForm.addDish')}
      </Button>
      {full && atMax !== undefined ? (
        <p className="text-xs text-muted-foreground">{atMax}</p>
      ) : null}
    </div>
  );
}
