'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ApiError,
  adminPlacesList,
  adminToursCreate,
  adminToursReplaceStops,
  adminToursUpdate,
  auditLogsList,
} from '@wayfare/api-client';
import {
  MAX_TOUR_MINUTES,
  MAX_TOUR_STOPS,
  MIN_TOUR_MINUTES,
  MIN_TOUR_STOPS_TO_ACTIVATE,
} from '@wayfare/contracts';
import { tourDistanceM } from '@wayfare/core';
import { Button } from '@wayfare/ui/button';
import { ChangeChip } from '@wayfare/ui/content';
import { Field, FieldError, FormAlert, Input, Select, Textarea } from '@wayfare/ui/field';
import { FormSection, SaveBar } from '@wayfare/ui/form';
import { PageHeader, SearchField } from '@wayfare/ui/list';
import { RouteMap } from '@wayfare/ui/route-map';
import { StatusBadge } from '@wayfare/ui/surfaces';
import { toast } from '@wayfare/ui/toaster';
import {
  ArrowDown,
  ArrowUp,
  Footprints,
  ImageUp,
  ListOrdered,
  Plus,
  Trash2,
  TriangleAlert,
  EyeOff,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { errorText } from '../client/errors';
import { useConsole } from '../i18n/provider';
import { useMe } from '../shell/me';
import { relativeTime } from '../notifications/text';
import { useMapStyle } from './place-page';
import { useAreas, useNames } from './reference';
import type { TourDetail } from './tour-page';
import { formatDistance } from './tour-words';
import { uploadPhoto } from './uploads';
import { printedCode, statusTone } from './words';

/** A stop the form holds: its Place as the editor shows it. */
interface FormStop {
  readonly placeId: string;
  readonly nameVi: string;
  readonly nameEn: string | null;
  readonly categoryCode: string;
  readonly status: string;
  readonly deleted: boolean;
  readonly outsideArea: boolean;
  readonly location: { readonly lat: number; readonly lng: number };
}

type FieldKey = 'titleVi' | 'descriptionVi' | 'estimatedMinutes' | 'areaId' | 'stops';
type Errors = Partial<Record<FieldKey, string>>;

const live = (stop: FormStop) => stop.status === 'ACTIVE' && !stop.deleted && !stop.outsideArea;

/**
 * Create and edit a tour (TA3, TA3b, TA3c): its text in Vietnamese, the area first — fixed while
 * the tour has stops — the stop editor (search over the area's Places, a tap on the map, ↑ ↓ ×,
 * the straight line and its distance), and the cover. It saves as a whole: `POST` on create;
 * `PATCH` and `PUT …/stops` on edit. A changed text on a live tour says what saving does.
 */
export function TourForm({ tour }: { tour: TourDetail | null }) {
  const translator = useConsole();
  const { t, tDynamic, locale } = translator;
  const router = useRouter();
  const names = useNames();
  const areas = useAreas();
  const editing = tour !== null;
  const me = useMe();
  // Who saved last: the tour's latest audit row (the tour keeps only who made it).
  const lastSave = useQuery({
    queryKey: ['history', 'TOUR', tour?.id, 'latest'],
    queryFn: () =>
      auditLogsList({
        resourceType: 'TOUR',
        resourceId: tour!.id,
        from: new Date(Date.parse(tour!.createdAt) - 60_000).toISOString(),
        to: new Date().toISOString(),
        limit: 1,
      }),
    enabled: tour !== null,
  });
  const [titleVi, setTitle] = useState(tour?.titleVi ?? '');
  const [descriptionVi, setDescription] = useState(tour?.descriptionVi ?? '');
  const [areaId, setArea] = useState(tour?.areaId ?? '');
  const [minutes, setMinutes] = useState(tour === null ? '' : String(tour.estimatedMinutes));
  const [stops, setStops] = useState<FormStop[]>(
    () =>
      tour?.stops.map((stop) => ({
        placeId: stop.placeId,
        nameVi: stop.nameVi,
        nameEn: stop.nameEn,
        categoryCode: stop.categoryCode,
        status: stop.status,
        deleted: stop.deleted,
        outsideArea: stop.outsideArea,
        location: stop.location,
      })) ?? [],
  );
  const [cover, setCover] = useState<{ uploadId: string | null; url: string } | null>(
    tour?.cover === null || tour === null ? null : { uploadId: null, url: tour.cover.card.url },
  );
  const [query, setQuery] = useState('');
  const [moved, setMoved] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState<'draft' | 'activate' | 'save' | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mapStyle = useMapStyle(areaId);
  const area = areas.data?.find((row) => row.id === areaId);
  const areaName = area === undefined ? '' : names.area(area.code);

  // The area's Places, any status but deleted: the map's dots and the search's pool.
  const pool = useQuery({
    queryKey: ['tour-pool', areaId],
    queryFn: async () => (await adminPlacesList({ areaId, pageSize: 100, sort: 'nameVi' })).data,
    enabled: areaId !== '',
  });
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return [];
    return (pool.data ?? []).filter((row) => row.nameVi.toLowerCase().includes(q)).slice(0, 8);
  }, [pool.data, query]);
  const inTour = new Set(stops.map((stop) => stop.placeId));

  const add = (placeId: string) => {
    const row = pool.data?.find((place) => place.id === placeId);
    if (row === undefined || inTour.has(placeId) || stops.length >= MAX_TOUR_STOPS) return;
    setStops([
      ...stops,
      {
        placeId: row.id,
        nameVi: row.nameVi,
        nameEn: null,
        categoryCode: row.categoryCode,
        status: row.status,
        deleted: false,
        outsideArea: false,
        location: row.location,
      },
    ]);
    setQuery('');
    setErrors({ ...errors, stops: undefined });
  };
  const move = (index: number, by: -1 | 1) => {
    const next = [...stops];
    const [stop] = next.splice(index, 1);
    next.splice(index + by, 0, stop!);
    setStops(next);
    setMoved(stop!.placeId);
    setTimeout(() => setMoved(null), 1000);
  };
  const remove = (index: number) => setStops(stops.filter((_, i) => i !== index));

  const distance = tourDistanceM(stops.map((stop) => stop.location));
  const liveCount = stops.filter(live).length;
  const titleChanged = editing && titleVi !== tour.titleVi;
  const descriptionChanged = editing && descriptionVi !== tour.descriptionVi;
  const textWarning = editing && tour.status === 'ACTIVE' && (titleChanged || descriptionChanged);

  /** The client's checks: the same rules the API holds, said in TA3c's words. */
  const check = (requestActivation: boolean): Errors => {
    const found: Errors = {};
    if (titleVi.trim() === '') found.titleVi = t('tourForm.needTitle');
    if (descriptionVi.trim() === '') found.descriptionVi = t('tourForm.needDescription');
    const m = Number(minutes);
    if (!Number.isInteger(m) || m < MIN_TOUR_MINUTES || m > MAX_TOUR_MINUTES)
      found.estimatedMinutes = t('tourForm.needMinutes');
    if (areaId === '') found.areaId = t('tourForm.needArea');
    if (requestActivation && stops.length < MIN_TOUR_STOPS_TO_ACTIVATE)
      found.stops = t('tourForm.needStops');
    return found;
  };
  /** A refusal from the API, onto its fields: a stop named by its Place. */
  const fromServer = (error: unknown): Errors | null => {
    if (!(error instanceof ApiError) || error.code !== 'VALIDATION_FAILED') return null;
    const issues = (error.details as { issues?: { path: string; code: string }[] }).issues ?? [];
    const found: Errors = {};
    for (const issue of issues) {
      const [, field, index] = issue.path.split('/');
      if (field === 'titleVi') found.titleVi = t('tourForm.needTitle');
      else if (field === 'descriptionVi') found.descriptionVi = t('tourForm.needDescription');
      else if (field === 'estimatedMinutes') found.estimatedMinutes = t('tourForm.needMinutes');
      else if (field === 'stops' || field === 'placeIds') {
        const place = index === undefined ? undefined : stops[Number(index)];
        found.stops =
          place === undefined
            ? t('tourForm.needStops')
            : issue.code === 'duplicate'
              ? t('tourForm.twice', { place: place.nameVi })
              : t('tourForm.notInArea', { place: place.nameVi, area: areaName });
      }
    }
    return found;
  };
  const refuse = (found: Errors) => {
    setErrors(found);
    const n = Object.values(found).filter((value) => value !== undefined).length;
    setAlert(editing ? t('tourForm.attentionSave', { n }) : t('tourForm.attentionCreate', { n }));
  };

  const create = async (requestActivation: boolean) => {
    const found = check(requestActivation);
    if (Object.keys(found).length > 0) return refuse(found);
    setBusy(requestActivation ? 'activate' : 'draft');
    try {
      const { data } = await adminToursCreate({
        titleVi,
        descriptionVi,
        areaId,
        estimatedMinutes: Number(minutes),
        ...(cover?.uploadId == null ? {} : { coverUploadId: cover.uploadId }),
        stops: stops.map((stop) => stop.placeId),
        requestActivation,
      });
      toast.success(t('tourForm.created', { title: titleVi }));
      router.push(`/tours/${data.tour.id}`);
    } catch (error) {
      setBusy(null);
      const found = fromServer(error);
      if (found === null) setAlert(errorText(error, translator));
      else refuse(found);
    }
  };

  const save = async () => {
    if (tour === null) return;
    const found = check(false);
    if (Object.keys(found).length > 0) return refuse(found);
    setBusy('save');
    try {
      const patch = {
        ...(titleVi === tour.titleVi ? {} : { titleVi }),
        ...(descriptionVi === tour.descriptionVi ? {} : { descriptionVi }),
        ...(Number(minutes) === tour.estimatedMinutes ? {} : { estimatedMinutes: Number(minutes) }),
        ...(cover === null && tour.cover !== null ? { coverUploadId: null } : {}),
        ...(cover?.uploadId == null ? {} : { coverUploadId: cover.uploadId }),
      };
      if (Object.keys(patch).length > 0) await adminToursUpdate(tour.id, patch);
      const ids = stops.map((stop) => stop.placeId);
      if (ids.join() !== tour.stops.map((stop) => stop.placeId).join()) {
        await adminToursReplaceStops(tour.id, { stops: ids });
      }
      toast.success(t('tourForm.saved'));
      router.push(`/tours/${tour.id}`);
    } catch (error) {
      setBusy(null);
      const found = fromServer(error);
      if (found === null) setAlert(errorText(error, translator));
      else refuse(found);
    }
  };

  const pickCover = async (file: File) => {
    try {
      const photo = await uploadPhoto(file, undefined, 'TOUR_COVER');
      setCover({ uploadId: 'uploadId' in photo ? photo.uploadId : null, url: photo.preview });
    } catch (error) {
      setAlert(errorText(error, translator));
    }
  };

  const savedLine = (
    actor: { type: string; userId: string | null; name: string | null } | null,
    when: string,
  ) =>
    actor !== null && actor.userId === me.user.id
      ? t('tourForm.savedByYou', { when })
      : t('tourForm.savedBy', { name: actor?.name ?? t('history.staff'), when });

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/tours" className="text-sm text-muted-foreground hover:underline">
            {t('tours.title')}
          </Link>
        }
        title={editing ? t('tourForm.editTitle') : t('tourForm.newTitle')}
        description={
          editing ? `${tour.titleVi} · ${printedCode(tour.publicCode)}` : t('tourForm.newLead')
        }
      />
      {alert === null ? null : <FormAlert>{alert}</FormAlert>}
      {textWarning ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-md bg-warning px-4 py-3 text-sm text-warning-foreground"
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span className="flex flex-col gap-1">
            <strong>
              {descriptionChanged ? t('tourForm.changedDescription') : t('tourForm.changedTitle')}
            </strong>
            {t('tourForm.changedBody')}
          </span>
        </p>
      ) : null}

      <FormSection title={t('tourForm.about')}>
        <Field
          label={t('tourForm.title')}
          required
          help={t('tourForm.titleHint')}
          error={errors.titleVi}
          badge={
            titleChanged ? (
              <ChangeChip change="changed">{t('tourForm.changedChip')}</ChangeChip>
            ) : undefined
          }
        >
          {(control) => (
            <span className="flex flex-col gap-1">
              <Input
                {...control}
                lang="vi"
                placeholder={t('tourForm.titlePlaceholder')}
                value={titleVi}
                onChange={(event) => setTitle(event.target.value)}
              />
            </span>
          )}
        </Field>
        <Field
          label={t('tourForm.description')}
          required
          help={t('tourForm.descriptionHint')}
          error={errors.descriptionVi}
          badge={
            descriptionChanged ? (
              <ChangeChip change="changed">{t('tourForm.changedChip')}</ChangeChip>
            ) : undefined
          }
        >
          {(control) => (
            <span className="flex flex-col gap-1">
              <Textarea
                {...control}
                lang="vi"
                rows={3}
                placeholder={t('tourForm.descriptionPlaceholder')}
                value={descriptionVi}
                onChange={(event) => setDescription(event.target.value)}
              />
            </span>
          )}
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label={t('tourForm.area')}
            required
            help={stops.length > 0 ? t('tourForm.areaFixed') : t('tourForm.areaHint')}
            error={errors.areaId}
          >
            {(control) => (
              <Select
                {...control}
                value={areaId}
                disabled={stops.length > 0}
                onChange={(event) => setArea(event.target.value)}
              >
                <option value="" disabled>
                  —
                </option>
                {(areas.data ?? []).map((row) => (
                  <option key={row.id} value={row.id}>
                    {names.area(row.code)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label={t('tourForm.minutes')}
            required
            help={t('tourForm.minutesHint')}
            error={errors.estimatedMinutes}
          >
            {(control) => (
              <Input
                {...control}
                inputMode="numeric"
                placeholder="120"
                value={minutes}
                onChange={(event) => setMinutes(event.target.value.replace(/\D/g, ''))}
              />
            )}
          </Field>
        </div>
      </FormSection>

      <div id="stops">
        <FormSection title={t('tour.stops')}>
          <p className="flex flex-wrap items-center gap-4 text-sm text-foreground">
            <span className="inline-flex items-center gap-1">
              <ListOrdered aria-hidden className="size-4" />
              {t('tourForm.stopCount', { n: stops.length })}
              {liveCount === stops.length
                ? null
                : ` · ${t('tourForm.liveCount', { n: liveCount })}`}
            </span>
            <span className="inline-flex items-center gap-1">
              <Footprints aria-hidden className="size-4" />
              {t('tourForm.along', { distance: formatDistance(distance, locale) })}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">{t('tourForm.recomputed')}</p>
          {errors.stops === undefined ? null : <FieldError>{errors.stops}</FieldError>}
          <div className="relative">
            <SearchField
              className="md:w-full"
              aria-label={
                areaId === ''
                  ? t('tourForm.chooseAreaFirst')
                  : t('tourForm.addPlaceholder', { area: areaName })
              }
              placeholder={
                areaId === ''
                  ? t('tourForm.chooseAreaFirst')
                  : t('tourForm.addPlaceholder', { area: areaName })
              }
              disabled={areaId === ''}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {results.length === 0 ? null : (
              <ul className="absolute top-full z-20 mt-1 flex w-full flex-col rounded-md border border-border bg-card p-1 shadow-2 lg:w-3/5">
                {results.map((row) => {
                  const already = inTour.has(row.id);
                  return (
                    <li
                      key={row.id}
                      className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-accent"
                    >
                      <span className="flex min-w-0 grow flex-col">
                        <span className={already ? 'text-muted-foreground' : 'text-foreground'}>
                          {row.nameVi}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {names.category(row.categoryCode)}
                        </span>
                      </span>
                      {/* At 360 the name keeps the room: no badge (TA3). */}
                      <span className="hidden sm:inline-flex">
                        <StatusBadge tone={statusTone(row.status)}>
                          {tDynamic(`status.${row.status}`)}
                        </StatusBadge>
                      </span>
                      {already ? (
                        <span className="w-24 text-right text-xs text-muted-foreground">
                          {t('tourForm.inTour')}
                        </span>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => add(row.id)}>
                          <Plus aria-hidden />
                          {t('tourForm.add')}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            <ol className="order-2 flex flex-col divide-y divide-border lg:order-1 lg:col-span-3">
              {stops.length === 0 ? (
                <li className="py-2 text-sm text-muted-foreground">{t('tourForm.noStops')}</li>
              ) : null}
              {stops.map((stop, index) => {
                const isLive = live(stop);
                const note = stop.deleted
                  ? t('tour.goneStop')
                  : stop.outsideArea
                    ? t('tour.outsideArea')
                    : isLive
                      ? null
                      : t('tour.notLiveStop');
                return (
                  <li
                    key={stop.placeId}
                    className={`flex items-center gap-3 rounded-md px-1 py-2 text-sm transition-colors ${moved === stop.placeId ? 'bg-accent' : ''}`}
                  >
                    <span
                      aria-hidden
                      className={`flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-medium ${isLive ? 'border-primary text-primary' : 'border-dashed border-muted-foreground text-muted-foreground'}`}
                    >
                      {index + 1}
                    </span>
                    <span className="flex min-w-0 grow flex-col">
                      <span className={isLive ? 'text-foreground' : 'text-muted-foreground'}>
                        {stop.nameEn ?? stop.nameVi}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {stop.nameVi} · {names.category(stop.categoryCode)}
                      </span>
                      {note === null ? null : (
                        <span className="flex items-center gap-1 text-xs text-warning-foreground">
                          {/* Not live is hidden from tourists, not an error; gone or outside is. */}
                          {stop.deleted || stop.outsideArea ? (
                            <TriangleAlert aria-hidden className="size-3" />
                          ) : (
                            <EyeOff aria-hidden className="size-3" />
                          )}
                          {note}
                        </span>
                      )}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${t('tourForm.moveUp')}: ${stop.nameVi}`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${t('tourForm.moveDown')}: ${stop.nameVi}`}
                      disabled={index === stops.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${t('tourForm.remove')}: ${stop.nameVi}`}
                      onClick={() => remove(index)}
                    >
                      <X aria-hidden />
                    </Button>
                  </li>
                );
              })}
            </ol>
            {/* Above the list until it sits beside it: the line stays in view while stops move. */}
            <div className="order-1 lg:order-2 lg:col-span-2">
              {mapStyle === null || area === undefined ? null : (
                <RouteMap
                  style={mapStyle}
                  className="h-80"
                  stops={stops.map((stop, index) => ({
                    point: stop.location,
                    label: String(index + 1),
                    faded: !live(stop),
                  }))}
                  candidates={(pool.data ?? []).map((row) => ({
                    id: row.id,
                    point: row.location,
                    label: `${t('tourForm.add')}: ${row.nameVi}`,
                  }))}
                  onPick={add}
                  center={area.center}
                  label={t('tour.stops')}
                />
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t('tourForm.mapNote')}</p>
        </FormSection>
      </div>

      <div id="cover">
        <FormSection title={t('tourForm.cover')}>
          <div className="flex flex-wrap items-start gap-4">
            {cover === null ? null : (
              <img src={cover.url} alt="" className="aspect-video w-64 rounded-md object-cover" />
            )}
            <div className="flex min-w-0 grow basis-64 flex-col gap-3">
              <p className="text-xs text-muted-foreground">{t('tourForm.coverHint')}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => fileInput.current?.click()}>
                  <ImageUp aria-hidden />
                  {cover === null ? t('tourForm.chooseCover') : t('tourForm.replace')}
                </Button>
                {cover === null ? null : (
                  <Button variant="ghost" onClick={() => setCover(null)}>
                    <Trash2 aria-hidden />
                    {t('tourForm.removeCover')}
                  </Button>
                )}
              </div>
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file !== undefined) void pickCover(file);
                  event.target.value = '';
                }}
              />
            </div>
          </div>
        </FormSection>
      </div>

      <SaveBar>
        <p className="mr-auto max-w-md text-xs text-muted-foreground">
          {editing
            ? savedLine(
                lastSave.data?.data[0]?.actor ?? null,
                relativeTime(tour.updatedAt, new Date(), translator),
              )
            : t('tourForm.footNote')}
        </p>
        <Button asChild variant="outline">
          <Link href={editing ? `/tours/${tour.id}` : '/tours'}>{t('tourForm.cancel')}</Link>
        </Button>
        {editing ? (
          <Button
            busy={busy === 'save' ? t('tourForm.save') : undefined}
            onClick={() => void save()}
          >
            {t('tourForm.save')}
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              busy={busy === 'draft' ? t('tourForm.createDraft') : undefined}
              onClick={() => void create(false)}
            >
              {t('tourForm.createDraft')}
            </Button>
            <Button
              busy={busy === 'activate' ? t('tourForm.createActivate') : undefined}
              onClick={() => void create(true)}
            >
              {t('tourForm.createActivate')}
            </Button>
          </>
        )}
      </SaveBar>
    </>
  );
}
