'use client';

import {
  ApiError,
  adminPlacesCreate,
  adminPlacesReplaceMenu,
  adminPlacesReplaceOpeningHours,
  adminPlacesReplacePhotos,
  adminPlacesUpdate,
} from '@wayfare/api-client';
import {
  DEFAULT_TRIGGER_RADIUS_M,
  MAX_DESCRIPTION_CHARS,
  MAX_TRIGGER_RADIUS_M,
  MIN_TRIGGER_RADIUS_M,
  NARRATION_PRIORITY_DEFAULT,
  NARRATION_PRIORITY_MAX,
  NARRATION_PRIORITY_MIN,
  zCreatePlaceInput,
  zPlaceContentInput,
} from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { LeaveDialog } from '@wayfare/ui/dialogs';
import { Field, FormAlert, Input, Textarea } from '@wayfare/ui/field';
import { FormSection, SaveBar, useLeaveGuard } from '@wayfare/ui/form';
import { PageHeader } from '@wayfare/ui/list';
import { PlaceMap } from '@wayfare/ui/map';
import type { MapPoint } from '@wayfare/ui/map';
import { toast } from '@wayfare/ui/toaster';
import { Info, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { errorText } from '../client/errors';
import { errorCount, validateForm } from '../forms/field-errors';
import type { FieldErrors } from '../forms/field-errors';
import { useConsole } from '../i18n/provider';
import { useReauthSave } from '../session/reauth';
import { useMe } from '../shell/me';
import { SliderField } from './editorial-section';
import { insidePolygon } from './geo';
import { ownerName } from './place-actions';
import { HoursEditor, MenuEditor, PhotosEditor, rowKey } from './place-form-parts';
import type { DishRow, HoursRow } from './place-form-parts';
import type { PlaceDetail } from './place-types';
import { useMapStyle } from './place-page';
import { useAreas, useCategories, useNames } from './reference';
import { radiusComparison } from './words';
import type { FormPhoto } from './uploads';

interface Values {
  nameVi: string;
  descriptionVi: string;
  categoryCode: string;
  addressVi: string;
  lat: string;
  lng: string;
  photos: FormPhoto[];
  hours: HoursRow[];
  menu: DishRow[];
  radius: number;
  priority: number;
}

const hoursOf = (place: PlaceDetail): HoursRow[] =>
  place.openingHours.map((row) => ({
    key: rowKey(),
    weekday: row.weekday ?? null,
    date: row.specificDate ?? null,
    opensAt: row.opensAt ?? '',
    closesAt: row.closesAt ?? '',
    closed: row.isClosed ?? false,
  }));

const initialValues = (place: PlaceDetail | null, center: MapPoint): Values => ({
  nameVi: place?.nameVi ?? '',
  descriptionVi: place?.descriptionVi ?? '',
  categoryCode: place?.categoryCode ?? '',
  addressVi: place?.addressVi ?? '',
  lat: String(place?.location.lat ?? center.lat),
  lng: String(place?.location.lng ?? center.lng),
  photos:
    place?.photos.map((photo) => ({
      key: photo.id,
      photoId: photo.id,
      preview: photo.thumb.url,
      altTextVi: photo.altTextVi ?? '',
    })) ?? [],
  hours: place === null ? [] : hoursOf(place),
  menu:
    place?.menuItems.map((item) => ({
      key: item.id,
      nameVi: item.nameVi,
      price: item.priceMinor === null ? '' : String(item.priceMinor),
      isAvailable: item.isAvailable,
    })) ?? [],
  radius: place?.triggerRadiusM ?? DEFAULT_TRIGGER_RADIUS_M,
  priority: place?.narrationPriority ?? NARRATION_PRIORITY_DEFAULT,
});

const hoursBody = (rows: readonly HoursRow[]) =>
  rows.map((row) => ({
    ...(row.date === null ? { weekday: row.weekday ?? 1 } : { specificDate: row.date }),
    ...(row.closed
      ? { isClosed: true }
      : { opensAt: row.opensAt, closesAt: row.closesAt, isClosed: false }),
  }));
const photosBody = (photos: readonly FormPhoto[]) =>
  photos.map((photo) => ({
    ...('photoId' in photo ? { photoId: photo.photoId } : { uploadId: photo.uploadId }),
    altTextVi: photo.altTextVi.trim() === '' ? null : photo.altTextVi.trim(),
  }));
const menuBody = (rows: readonly DishRow[]) =>
  rows.map((row) => ({
    nameVi: row.nameVi,
    priceMinor: row.price === '' ? null : Number(row.price),
    isAvailable: row.isAvailable,
  }));

/**
 * Create (L4) and edit (L5): round 33's form page in the handoff's sections. Photos are uploaded
 * as they are added; the location is the map dragged under a fixed pin, with the coordinates as
 * its text equivalent — the only control where the area has no published map pack. An edit sends
 * the text change, then each list that changed; a stale one (L5b) keeps what was typed.
 */
export function PlaceForm({ place }: { place: PlaceDetail | null }) {
  const translator = useConsole();
  const { t, tDynamic } = translator;
  const me = useMe();
  const router = useRouter();
  const names = useNames();
  const areas = useAreas();
  const categories = useCategories();
  const firstCenter = areas.data?.[0]?.center ?? { lat: 10.7769, lng: 106.7009 };
  const [values, setValues] = useState<Values>(() => initialValues(place, firstCenter));
  const [saved, setSaved] = useState<Values>(values);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState<'draft' | 'activate' | 'save' | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const editing = place !== null;
  const venue = place?.kind === 'VENUE';
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);
  useLeaveGuard(dirty && leaving === null && busy === null, setLeaving);

  const point = { lat: Number(values.lat), lng: Number(values.lng) };
  const validPoint =
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    values.lat !== '' &&
    values.lng !== '';
  const area = useMemo(
    () =>
      areas.data?.find(
        (row) =>
          validPoint &&
          row.boundary.coordinates[0] !== undefined &&
          insidePolygon(point, row.boundary.coordinates[0]),
      ) ??
      areas.data?.find((row) => row.id === place?.areaId) ??
      null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the point's numbers are its identity
    [areas.data, place?.areaId, values.lat, values.lng],
  );
  const mapStyle = useMapStyle(area?.id ?? '');
  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues((current) => ({ ...current, [key]: value }));
  const editorialChoices = (categories.data ?? []).filter((row) =>
    venue ? row.appliesTo !== 'EDITORIAL' : row.appliesTo !== 'VENUE',
  );

  const content = () => ({
    nameVi: values.nameVi,
    descriptionVi: values.descriptionVi,
    categoryCode: values.categoryCode,
    location: { lat: point.lat, lng: point.lng },
    addressVi: values.addressVi.trim() === '' ? null : values.addressVi,
  });
  const overrides = {
    triggerRadiusM: () => t('editorial.radiusRange'),
    narrationPriority: () => t('editorial.priorityRange'),
  };

  const create = async (requestActivation: boolean) => {
    const body = {
      ...content(),
      triggerRadiusM: values.radius,
      narrationPriority: values.priority,
      photos: photosBody(values.photos).map((photo) => ({
        uploadId: (photo as { uploadId: string }).uploadId,
        altTextVi: photo.altTextVi,
      })),
      openingHours: hoursBody(values.hours),
      requestActivation,
    };
    const checked = validateForm(zCreatePlaceInput, body, translator, overrides);
    if (!checked.ok) return { errors: checked.errors };
    const { data } = await adminPlacesCreate(checked.data);
    return { id: data.place.id };
  };

  const update = async () => {
    const before = initialValues(place, firstCenter);
    const text = content();
    const was = contentOf(before);
    const changed = Object.fromEntries(
      Object.entries(text).filter(
        ([key, value]) => JSON.stringify(value) !== JSON.stringify(was[key as keyof typeof was]),
      ),
    );
    const checked = validateForm(zPlaceContentInput.partial(), changed, translator, overrides);
    if (!checked.ok) return { errors: checked.errors };
    if (Object.keys(checked.data).length > 0) await adminPlacesUpdate(place!.id, checked.data);
    if (JSON.stringify(values.photos) !== JSON.stringify(before.photos)) {
      await adminPlacesReplacePhotos(place!.id, { items: photosBody(values.photos) });
    }
    if (
      JSON.stringify(values.hours.map(({ key: _key, ...row }) => row)) !==
      JSON.stringify(before.hours.map(({ key: _key, ...row }) => row))
    ) {
      await adminPlacesReplaceOpeningHours(place!.id, { items: hoursBody(values.hours) });
    }
    if (venue && JSON.stringify(values.menu) !== JSON.stringify(before.menu)) {
      await adminPlacesReplaceMenu(place.id, {
        menuCurrency: place.menuCurrency,
        items: menuBody(values.menu),
      });
    }
    return { id: place!.id };
  };

  const pending = useRef<'draft' | 'activate' | 'save'>('save');
  const { run, dialog } = useReauthSave(
    () => (pending.current === 'save' ? update() : create(pending.current === 'activate')),
    { email: me.user.email, name: values.nameVi || t('placeForm.newTitle') },
  );

  const submit = async (which: 'draft' | 'activate' | 'save') => {
    if (busy !== null) return;
    pending.current = which;
    setBusy(which);
    setAlert(null);
    setStale(false);
    try {
      const outcome = await run();
      if (outcome === undefined) return;
      if ('errors' in outcome) {
        const found = outcome.errors ?? {};
        setErrors(
          found.nameVi === undefined ? found : { ...found, nameVi: t('placeForm.giveName') },
        );
        return;
      }
      setErrors({});
      setSaved(values);
      toast.success(editing ? t('placeForm.saved') : t('placeForm.created'));
      router.push(`/places/${outcome.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_STATE') setStale(true);
      else
        setAlert(
          error instanceof ApiError
            ? tDynamic(`error.${error.code}`, undefined, errorText(error, translator))
            : errorText(error, translator),
        );
    } finally {
      setBusy(null);
    }
  };

  const count = errorCount(errors);
  const descriptionChanged = editing && values.descriptionVi !== place.descriptionVi;
  const owner = place === null ? '' : ownerName(place, t('place.aVenueOwner'));
  const latError = errors.location;

  return (
    <>
      <PageHeader
        breadcrumb={
          <span className="text-sm text-muted-foreground">
            <Link href="/places" className="hover:underline">
              {t('places.title')}
            </Link>
            {editing ? (
              <>
                {' / '}
                <Link href={`/places/${place.id}`} className="hover:underline">
                  {place.nameVi}
                </Link>
              </>
            ) : null}
          </span>
        }
        title={editing ? t('placeForm.editTitle', { name: place.nameVi }) : t('placeForm.newTitle')}
        description={editing ? t('placeForm.editLead') : t('placeForm.newLead')}
      />
      <form
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(editing ? 'save' : 'activate');
        }}
      >
        <div className="flex max-w-3xl flex-col gap-6">
          {stale ? (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-md border border-warning-foreground bg-warning px-4 py-3 text-sm text-warning-foreground"
            >
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span className="flex-1">
                <strong className="block">{t('placeForm.staleTitle')}</strong>
                {t('placeForm.staleBody', { name: place?.nameVi ?? values.nameVi })}
              </span>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setStale(false);
                  router.refresh();
                }}
              >
                {t('placeForm.reload')}
              </Button>
            </div>
          ) : null}
          {venue ? (
            <p className="flex items-start gap-2 rounded-md bg-info px-3 py-2 text-sm text-info-foreground">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
              {t('placeForm.ownerTold', { name: place?.nameVi ?? '', owner })}
            </p>
          ) : null}
          {count > 0 ? (
            <FormAlert>
              {editing
                ? t('placeForm.attentionSaved', { count })
                : t('placeForm.attention', { count })}
            </FormAlert>
          ) : alert === null ? null : (
            <FormAlert>{alert}</FormAlert>
          )}

          <FormSection title={t('placeForm.about')}>
            <Field
              label={t('placeForm.name')}
              required
              help={t('placeForm.nameHelp')}
              error={errors.nameVi}
            >
              {(control) => (
                <Input
                  {...control}
                  lang="vi"
                  value={values.nameVi}
                  onChange={(event) => set('nameVi', event.target.value)}
                />
              )}
            </Field>
            <Field label={t('place.category')} required error={errors.categoryCode}>
              {(control) => (
                <select
                  {...control}
                  value={values.categoryCode}
                  onChange={(event) => set('categoryCode', event.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="" disabled>
                    —
                  </option>
                  {editorialChoices.map((row) => (
                    <option key={row.code} value={row.code}>
                      {names.category(row.code)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field
              label={t('placeForm.description')}
              required
              help={t('placeForm.descriptionHelp', {
                min: 1,
                max: MAX_DESCRIPTION_CHARS,
                count: values.descriptionVi.trim().length,
              })}
              error={errors.descriptionVi}
            >
              {(control) => (
                <Textarea
                  {...control}
                  lang="vi"
                  rows={6}
                  value={values.descriptionVi}
                  onChange={(event) => set('descriptionVi', event.target.value)}
                />
              )}
            </Field>
            {descriptionChanged ? (
              <p
                role="status"
                className="flex items-start gap-2 rounded-md bg-warning px-3 py-2 text-sm text-warning-foreground"
              >
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                {t('placeForm.textWarning', { name: place.nameVi })}
              </p>
            ) : null}
          </FormSection>

          <FormSection title={t('placeForm.location')}>
            {mapStyle === null || !validPoint ? (
              <p className="text-sm text-muted-foreground">{t('placeForm.noMap')}</p>
            ) : (
              <>
                <PlaceMap
                  style={mapStyle}
                  center={point}
                  radiusM={editing ? undefined : values.radius}
                  label={t('placeForm.mapLabel')}
                  onMove={(next) =>
                    setValues((current) => ({
                      ...current,
                      lat: String(next.lat),
                      lng: String(next.lng),
                    }))
                  }
                  className="h-72"
                />
                <p className="text-xs text-muted-foreground">{t('placeForm.mapHelp')}</p>
              </>
            )}
            <Field label={t('placeForm.address')} error={errors.addressVi}>
              {(control) => (
                <Input
                  {...control}
                  lang="vi"
                  value={values.addressVi}
                  onChange={(event) => set('addressVi', event.target.value)}
                />
              )}
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t('placeForm.latitude')} required error={latError}>
                {(control) => (
                  <Input
                    {...control}
                    inputMode="decimal"
                    value={values.lat}
                    onChange={(event) => set('lat', event.target.value)}
                  />
                )}
              </Field>
              <Field label={t('placeForm.longitude')} required error={latError}>
                {(control) => (
                  <Input
                    {...control}
                    inputMode="decimal"
                    value={values.lng}
                    onChange={(event) => set('lng', event.target.value)}
                  />
                )}
              </Field>
            </div>
          </FormSection>

          <section id="photos" aria-label={t('placeForm.photos')}>
            <FormSection title={t('placeForm.photos')}>
              <PhotosEditor
                photos={values.photos}
                onChange={(photos) => set('photos', photos)}
                error={errors.photos}
              />
            </FormSection>
          </section>

          <section id="hours" aria-label={t('placeForm.hours')}>
            <FormSection title={t('placeForm.hours')}>
              <HoursEditor rows={values.hours} onChange={(hours) => set('hours', hours)} />
            </FormSection>
          </section>

          {venue ? (
            <section id="menu" aria-label={t('placeForm.menu')}>
              <FormSection title={t('placeForm.menu')}>
                <MenuEditor rows={values.menu} onChange={(menu) => set('menu', menu)} />
              </FormSection>
            </section>
          ) : null}

          {editing ? null : (
            <FormSection title={t('placeForm.editorial')}>
              <p className="text-sm text-muted-foreground">{t('placeForm.editorialLead')}</p>
              <SliderField
                label={t('editorial.radius')}
                help={t('editorial.radiusHelp', {
                  m: values.radius,
                  comparison: t(radiusComparison(values.radius)),
                })}
                error={errors.triggerRadiusM}
                value={values.radius}
                min={MIN_TRIGGER_RADIUS_M}
                max={MAX_TRIGGER_RADIUS_M}
                unit="m"
                onChange={(radius) => set('radius', radius)}
              />
              <SliderField
                label={t('editorial.priority')}
                help={t('editorial.priorityHelp')}
                error={errors.narrationPriority}
                value={values.priority}
                min={NARRATION_PRIORITY_MIN}
                max={NARRATION_PRIORITY_MAX}
                onChange={(priority) => set('priority', priority)}
              />
            </FormSection>
          )}
        </div>
        <SaveBar>
          <p className="mr-auto self-center text-xs text-muted-foreground">
            {editing ? t('placeForm.editNote') : t('placeForm.createNote')}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              dirty ? setLeaving(editing ? `/places/${place.id}` : '/places') : router.back()
            }
          >
            {t('action.cancel')}
          </Button>
          {editing ? (
            <Button type="submit" busy={busy === 'save' ? t('action.saving') : undefined}>
              {t('action.save')}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                busy={busy === 'draft' ? t('action.saving') : undefined}
                disabled={busy !== null}
                onClick={() => void submit('draft')}
              >
                {t('placeForm.createDraft')}
              </Button>
              <Button
                type="submit"
                busy={busy === 'activate' ? t('action.saving') : undefined}
                disabled={busy !== null}
              >
                {t('placeForm.createActivate')}
              </Button>
            </>
          )}
        </SaveBar>
      </form>
      {dialog}
      <LeaveDialog
        open={leaving !== null}
        onOpenChange={(open) => !open && setLeaving(null)}
        title={t('leave.title')}
        description={t('leave.body', { name: values.nameVi || t('placeForm.newTitle') })}
        stay={t('leave.stay')}
        leave={t('leave.leave')}
        closeLabel={t('action.close')}
        onLeave={() => {
          const href = leaving ?? '/places';
          setSaved(values);
          router.push(href);
        }}
      />
    </>
  );
}

/** The text fields of a form's values, as the API takes them. */
function contentOf(values: Values) {
  return {
    nameVi: values.nameVi,
    descriptionVi: values.descriptionVi,
    categoryCode: values.categoryCode,
    location: { lat: Number(values.lat), lng: Number(values.lng) },
    addressVi: values.addressVi.trim() === '' ? null : values.addressVi,
  };
}
