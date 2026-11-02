'use client';

import {
  ApiError,
  adminPlacesCreate,
  adminPlacesReplaceMenu,
  adminPlacesReplaceOpeningHours,
  adminPlacesReplacePhotos,
  adminPlacesUpdate,
  ownerSubmissionsCreate,
} from '@wayfare/api-client';
import {
  DEFAULT_TRIGGER_RADIUS_M,
  MAX_DESCRIPTION_CHARS,
  MAX_TRIGGER_RADIUS_M,
  MIN_TRIGGER_RADIUS_M,
  NARRATION_PRIORITY_DEFAULT,
  NARRATION_PRIORITY_MAX,
  NARRATION_PRIORITY_MIN,
  scopeLanguages,
  zCreatePlaceInput,
  zPlaceContentInput,
  zPlaceSubmissionPayload,
} from '@wayfare/contracts';
import { MenuCurrency } from '@wayfare/contracts';
import type { NarrationLanguageScope, PlaceSubmissionPayload } from '@wayfare/contracts';
import { ChangeChip } from '@wayfare/ui/content';
import { Button } from '@wayfare/ui/button';
import { LeaveDialog } from '@wayfare/ui/dialogs';
import { Field, FieldError, FormAlert, Input, Select, Textarea } from '@wayfare/ui/field';
import { FormSection, SaveBar, useLeaveGuard } from '@wayfare/ui/form';
import { PageHeader } from '@wayfare/ui/list';
import { PlaceMap } from '@wayfare/ui/map';
import type { MapPoint } from '@wayfare/ui/map';
import { Card } from '@wayfare/ui/surfaces';
import { toast } from '@wayfare/ui/toaster';
import { Info, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useMemo, useRef, useState } from 'react';
import { errorText } from '../client/errors';
import { errorCount, serverFieldErrors, validateForm } from '../forms/field-errors';
import { formatDate, formatPhone, toE164 } from '../i18n/format';
import { languageName } from '../i18n/language-names';
import { useBillingOverview, useLimits, useOwnerPlaces, usePlans } from '../owner/queries';
import type { OwnerPlaceDetail } from '../owner/queries';
import { Notice } from '../owner/registration';
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
  /** An owner's (K13): *Contact and price*, and the menu's one currency. */
  priceBand: string;
  phone: string;
  websiteUrl: string;
  menuCurrency: 'VND' | 'USD';
}

/** A coordinate as its field shows it: six decimals (about 10 cm), never a float's noise. */
const coordinate = (value: number): string => String(Number(value.toFixed(6)));

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
  lat: coordinate(place?.location.lat ?? center.lat),
  lng: coordinate(place?.location.lng ?? center.lng),
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
      descriptionVi: item.descriptionVi ?? null,
    })) ?? [],
  radius: place?.triggerRadiusM ?? DEFAULT_TRIGGER_RADIUS_M,
  priority: place?.narrationPriority ?? NARRATION_PRIORITY_DEFAULT,
  priceBand: place?.priceBand === null || place === null ? '' : String(place.priceBand),
  phone: place?.phone == null ? '' : formatPhone(place.phone),
  websiteUrl: place?.websiteUrl ?? '',
  menuCurrency: place?.menuCurrency === 'USD' ? 'USD' : 'VND',
});

/** "Propose again" (Q2b): the form opens with a sent submission's content. */
const fromPayload = (base: Values, payload: PlaceSubmissionPayload): Values => ({
  ...base,
  nameVi: payload.nameVi,
  descriptionVi: payload.descriptionVi,
  categoryCode: payload.categoryCode,
  addressVi: payload.addressVi ?? '',
  lat: coordinate(payload.location.lat),
  lng: coordinate(payload.location.lng),
  priceBand: payload.priceBand === null ? '' : String(payload.priceBand),
  phone: payload.phone === null ? '' : formatPhone(payload.phone),
  websiteUrl: payload.websiteUrl ?? '',
  menuCurrency: payload.menu.menuCurrency === MenuCurrency.USD ? 'USD' : 'VND',
  hours: payload.openingHours.map((row) => ({
    key: rowKey(),
    weekday: row.weekday ?? null,
    date: row.specificDate ?? null,
    opensAt: row.opensAt ?? '',
    closesAt: row.closesAt ?? '',
    closed: row.isClosed ?? false,
  })),
  menu: payload.menu.items.map((item) => ({
    key: rowKey(),
    nameVi: item.nameVi,
    price: item.priceMinor === null ? '' : String(item.priceMinor),
    isAvailable: item.isAvailable,
    descriptionVi: item.descriptionVi,
  })),
  // A kept photo is still the venue's; a new upload from then has expired.
  photos: base.photos.filter((photo) =>
    payload.photos.some((item) => 'photoId' in photo && item.photoId === photo.photoId),
  ),
});

/** What an owner's form shows of the plan (F3), from `/owner/places/limits` and the plans. */
interface OwnerPlan {
  readonly name: string;
  readonly maxPhotos: number;
  readonly maxDishes: number;
  readonly scope: NarrationLanguageScope;
  readonly autoNarration: boolean;
  readonly maxPlaces: number;
  readonly waiting: number;
  readonly next: {
    readonly name: string;
    readonly maxPhotos: number;
    readonly maxDishes: number;
    readonly scope: NarrationLanguageScope;
  } | null;
}

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
export function PlaceForm({
  place: given,
  audience = 'staff',
  baseHash,
  waiting,
  again,
}: {
  place: PlaceDetail | OwnerPlaceDetail['place'] | null;
  /** An owner proposes (K13): no editorial section, no trigger circle, *Contact and price*. */
  audience?: 'staff' | 'owner';
  /** The `editableHash` the owner's edit opened with. */
  baseHash?: string;
  /** The venue's change already waiting (F2). */
  waiting?: OwnerPlaceDetail['pendingSubmission'];
  /** A sent submission's content to start from (Q2b's *Propose again*). */
  again?: PlaceSubmissionPayload;
}) {
  // The owner's read is the admin's Place without `owner`, which only the staff mode names.
  const place = given as PlaceDetail | null;
  const translator = useConsole();
  const { t, tDynamic, locale } = translator;
  const me = useMe();
  const router = useRouter();
  const names = useNames();
  const areas = useAreas();
  const categories = useCategories();
  const ownerMode = audience === 'owner';
  const limits = useLimits(ownerMode);
  const billing = useBillingOverview(ownerMode);
  const plans = usePlans(ownerMode);
  const owned = useOwnerPlaces(undefined, ownerMode);
  // The venue holding a one-place plan's place, to name it (F6).
  const using = owned.data?.find((row) => row.status === 'ACTIVE' || row.status === 'PROCESSING');
  const firstCenter = areas.data?.[0]?.center ?? { lat: 10.7769, lng: 106.7009 };
  const [values, setValues] = useState<Values>(() => {
    const base = initialValues(place, firstCenter);
    return again === undefined ? base : fromPayload(base, again);
  });
  const locationError = useId();
  const [ownerAlert, setOwnerAlert] = useState<'limit' | 'conflict' | null>(null);
  const [sent, setSent] = useState<{ id: string; name: string } | null>(null);
  const [saved, setSaved] = useState<Values>(values);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState<'draft' | 'activate' | 'save' | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const editing = place !== null;
  const venue = ownerMode || place?.kind === 'VENUE';
  const ownerPlan: OwnerPlan | null =
    limits.data === undefined
      ? null
      : (() => {
          const current = limits.data;
          const next =
            plans.data?.find(
              (plan) =>
                plan.code !== billing.data?.plan.code && plan.grants.maxPlaces > current.maxPlaces,
            ) ?? null;
          return {
            name: billing.data?.plan.name ?? '',
            maxPhotos: current.maxPhotosPerPlace,
            maxDishes: current.maxMenuItemsPerPlace,
            scope: current.narrationLanguageScope as NarrationLanguageScope,
            autoNarration: current.autoNarration,
            maxPlaces: current.maxPlaces,
            waiting: current.reservedByPendingSubmissions,
            next:
              next === null
                ? null
                : {
                    name: next.name,
                    maxPhotos: next.grants.maxPhotosPerPlace,
                    maxDishes: next.grants.maxMenuItemsPerPlace,
                    scope: next.grants.narrationLanguageScope as NarrationLanguageScope,
                  },
          };
        })();
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
    if (place?.kind === 'VENUE' && JSON.stringify(values.menu) !== JSON.stringify(before.menu)) {
      await adminPlacesReplaceMenu(place.id, {
        menuCurrency: place.menuCurrency,
        items: menuBody(values.menu),
      });
    }
    return { id: place!.id };
  };

  /** An owner's complete desired state (K13): every optional field stated. */
  const payloadOf = () => ({
    ...content(),
    priceBand: values.priceBand === '' ? null : Number(values.priceBand),
    phone: values.phone.trim() === '' ? null : toE164(values.phone),
    websiteUrl: values.websiteUrl.trim() === '' ? null : values.websiteUrl.trim(),
    openingHours: hoursBody(values.hours),
    photos: photosBody(values.photos),
    menu: {
      menuCurrency: values.menuCurrency,
      items: values.menu.map((row) => ({
        nameVi: row.nameVi,
        descriptionVi: row.descriptionVi ?? null,
        priceMinor: row.price === '' ? null : Number(row.price),
        isAvailable: row.isAvailable,
      })),
    },
  });

  const propose = async () => {
    if (busy !== null) return;
    setBusy('save');
    setAlert(null);
    setOwnerAlert(null);
    const payload = payloadOf();
    const checked = validateForm(zPlaceSubmissionPayload, payload, translator, {
      phone: () => t('issue.phone'),
      websiteUrl: () => t('ownerForm.websiteIssue'),
    });
    if (!checked.ok) {
      setErrors(checked.errors);
      setBusy(null);
      return;
    }
    try {
      const { data } = await ownerSubmissionsCreate(
        editing
          ? {
              kind: 'UPDATE',
              placeId: place.id,
              baseEditableHash: baseHash ?? '',
              payload: checked.data,
            }
          : { kind: 'CREATE', payload: checked.data },
      );
      setErrors({});
      setSaved(values);
      setSent({ id: data.submission.id, name: values.nameVi });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : '';
      if (code === 'PLACE_LIMIT_REACHED') setOwnerAlert('limit');
      else if (code === 'SUBMISSION_CONFLICT') setOwnerAlert('conflict');
      else if (code === 'LOCATION_OUTSIDE_AREAS')
        setErrors({
          location: t('ownerForm.outside', {
            areas: (areas.data ?? []).map((row) => names.area(row.code)).join(', '),
          }),
        });
      else if (code === 'PHOTO_LIMIT_REACHED') setErrors({ photos: t('ownerForm.photoLimit') });
      else if (code === 'MENU_LIMIT_REACHED') setErrors({ menu: t('ownerForm.menuLimit') });
      else if (code === 'VALIDATION_FAILED' && error instanceof ApiError)
        setErrors(serverFieldErrors(error.details, payload, translator));
      else setAlert(errorText(error, translator));
    } finally {
      setBusy(null);
    }
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the form's first values, once
  const initial = useMemo(() => initialValues(place, firstCenter), [place]);
  /** Round 34's *Changed* chip on an owner's edit, for a section whose values moved. */
  const changed = (...keys: (keyof Values)[]) =>
    ownerMode &&
    editing &&
    keys.some((key) => JSON.stringify(values[key]) !== JSON.stringify(initial[key])) ? (
      <ChangeChip change="changed">{t('change.changed')}</ChangeChip>
    ) : undefined;
  const listHref = ownerMode ? '/owner/venues' : '/places';
  const pageHref = (id: string) => (ownerMode ? `/owner/venues/${id}` : `/places/${id}`);

  if (sent !== null) {
    return (
      <Card className="flex max-w-2xl flex-col gap-4" aria-labelledby="sent-heading">
        <h1 id="sent-heading" className="text-2xl font-semibold text-foreground">
          {t('sent.title')}
        </h1>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-foreground">
          <li>{t('sent.reviews', { venue: sent.name })}</li>
          <li>{t('sent.live')}</li>
          {editing ? null : <li>{t('sent.holds')}</li>}
        </ul>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild>
            <Link href={`/owner/submissions/${sent.id}`}>{t('sent.see')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/owner/venues">{t('sent.back')}</Link>
          </Button>
        </div>
      </Card>
    );
  }
  const descriptionChanged = editing && values.descriptionVi !== place.descriptionVi;
  const owner = place === null ? '' : ownerName(place, t('place.aVenueOwner'));
  const latError = errors.location;
  const located =
    latError === undefined
      ? {}
      : { 'aria-invalid': true as const, 'aria-describedby': locationError };

  return (
    <>
      <PageHeader
        breadcrumb={
          <span className="text-sm text-muted-foreground">
            <Link href={listHref} className="hover:underline">
              {ownerMode ? t('venues.title') : t('places.title')}
            </Link>
            {editing ? (
              <>
                {' / '}
                <Link href={pageHref(place.id)} className="hover:underline">
                  {place.nameVi}
                </Link>
              </>
            ) : null}
          </span>
        }
        title={
          ownerMode
            ? editing
              ? t('ownerForm.editTitle', { venue: place.nameVi })
              : t('ownerForm.newTitle')
            : editing
              ? t('placeForm.editTitle', { name: place.nameVi })
              : t('placeForm.newTitle')
        }
        description={
          ownerMode
            ? editing
              ? t('ownerForm.editLead')
              : t('ownerForm.newLead')
            : editing
              ? t('placeForm.editLead')
              : t('placeForm.newLead')
        }
      />
      <form
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          void (ownerMode ? propose() : submit(editing ? 'save' : 'activate'));
        }}
      >
        <div className="flex max-w-3xl flex-col gap-6">
          {stale ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-warning-foreground bg-warning px-4 py-3 text-sm text-warning-foreground"
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
          {venue && !ownerMode ? (
            <p className="flex items-start gap-2 rounded-md bg-info px-3 py-2 text-sm text-info-foreground">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
              {t('placeForm.ownerTold', { name: place?.nameVi ?? '', owner })}
            </p>
          ) : null}
          {ownerAlert === 'limit' && ownerPlan !== null ? (
            <FormAlert
              action={
                <Button asChild size="sm" variant="outline">
                  <Link href="/owner/billing/plans">{t('venues.seePlans')}</Link>
                </Button>
              }
            >
              <strong className="block">{t('ownerForm.limitTitle')}</strong>
              {ownerPlan.maxPlaces === 1 && using !== undefined
                ? t('ownerForm.limitBodyOne', { plan: ownerPlan.name, venue: using.nameVi })
                : ownerPlan.waiting === 0
                  ? t('ownerForm.limitBodyNoWaiting', {
                      plan: ownerPlan.name,
                      max: ownerPlan.maxPlaces,
                    })
                  : t('ownerForm.limitBody', {
                      plan: ownerPlan.name,
                      max: ownerPlan.maxPlaces,
                      waiting: ownerPlan.waiting,
                    })}
            </FormAlert>
          ) : null}
          {ownerAlert === 'conflict' && editing ? (
            <FormAlert
              action={
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setOwnerAlert(null);
                    router.refresh();
                  }}
                >
                  {t('ownerForm.reload')}
                </Button>
              }
            >
              <strong className="block">
                {t('ownerForm.conflictTitle', { venue: place.nameVi })}
              </strong>
              {t('ownerForm.conflictBody', { venue: place.nameVi })}
            </FormAlert>
          ) : null}
          {ownerMode && waiting != null ? (
            <Notice tone="warning" title={t('ownerForm.waitingTitle')}>
              {t('ownerForm.waitingBody', {
                date: formatDate(waiting.submittedAt, locale),
                fields: (waiting.diff ?? [])
                  .map((entry) => tDynamic(`field.${entry.field}`))
                  .join(', '),
              })}
            </Notice>
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

          <FormSection
            title={ownerMode ? t('ownerForm.about') : t('placeForm.about')}
            badge={changed('nameVi', 'categoryCode', 'descriptionVi')}
          >
            <Field
              label={t('placeForm.name')}
              required
              help={t('placeForm.nameHelp')}
              error={errors.nameVi}
            >
              {(control) => (
                <Input
                  {...control}
                  placeholder={
                    ownerMode ? t('ownerForm.namePlaceholder') : t('placeForm.namePlaceholder')
                  }
                  lang="vi"
                  value={values.nameVi}
                  onChange={(event) => set('nameVi', event.target.value)}
                />
              )}
            </Field>
            <Field
              label={t('place.category')}
              required
              help={ownerMode ? t('ownerForm.categoryHelp') : undefined}
              error={errors.categoryCode}
            >
              {(control) => (
                <Select
                  {...control}
                  value={values.categoryCode}
                  onChange={(event) => set('categoryCode', event.target.value)}
                >
                  <option value="" disabled>
                    {ownerMode ? t('ownerForm.categoryPlaceholder') : '—'}
                  </option>
                  {editorialChoices.map((row) => (
                    <option key={row.code} value={row.code}>
                      {names.category(row.code)}
                    </option>
                  ))}
                </Select>
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
                  placeholder={
                    ownerMode
                      ? t('ownerForm.descriptionPlaceholder')
                      : t('placeForm.descriptionPlaceholder')
                  }
                  lang="vi"
                  rows={6}
                  value={values.descriptionVi}
                  onChange={(event) => set('descriptionVi', event.target.value)}
                />
              )}
            </Field>
            {descriptionChanged && !ownerMode ? (
              <p
                role="status"
                className="flex items-start gap-2 rounded-md bg-warning px-3 py-2 text-sm text-warning-foreground"
              >
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                {t('placeForm.textWarning', { name: place.nameVi })}
              </p>
            ) : null}
          </FormSection>

          {ownerMode ? (
            <FormSection
              title={t('ownerForm.contact')}
              badge={changed('priceBand', 'phone', 'websiteUrl')}
            >
              <Field
                label={t('ownerForm.price')}
                help={t('ownerForm.priceHelp')}
                error={errors.priceBand}
              >
                {(control) => (
                  <Select
                    {...control}
                    value={values.priceBand}
                    onChange={(event) => set('priceBand', event.target.value)}
                  >
                    <option value="">{t('ownerForm.pricePlaceholder')}</option>
                    {[1, 2, 3, 4].map((band) => (
                      <option key={band} value={String(band)}>
                        {t('place.priceRange', { band })}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
                <Field label={t('ownerForm.phone')} error={errors.phone}>
                  {(control) => (
                    <Input
                      {...control}
                      type="tel"
                      autoComplete="tel"
                      placeholder={t('ownerForm.phonePlaceholder')}
                      value={values.phone}
                      onChange={(event) => set('phone', event.target.value)}
                    />
                  )}
                </Field>
                <Field label={t('ownerForm.website')} error={errors.websiteUrl}>
                  {(control) => (
                    <Input
                      {...control}
                      type="url"
                      placeholder={t('ownerForm.websitePlaceholder')}
                      value={values.websiteUrl}
                      onChange={(event) => set('websiteUrl', event.target.value)}
                    />
                  )}
                </Field>
              </div>
            </FormSection>
          ) : null}

          <FormSection title={t('placeForm.location')} badge={changed('addressVi', 'lat', 'lng')}>
            {mapStyle === null || !validPoint ? (
              <p className="text-sm text-muted-foreground">{t('placeForm.noMap')}</p>
            ) : (
              <>
                <PlaceMap
                  style={mapStyle}
                  center={point}
                  radiusM={editing || ownerMode ? undefined : values.radius}
                  label={t('placeForm.mapLabel')}
                  onMove={(next) =>
                    setValues((current) => ({
                      ...current,
                      lat: coordinate(next.lat),
                      lng: coordinate(next.lng),
                    }))
                  }
                  className="h-72"
                />
                <p className="text-xs text-muted-foreground">{t('placeForm.mapHelp')}</p>
              </>
            )}
            {/* One place is wrong, so one message, under the map; both coordinates point to it. */}
            {latError === undefined ? null : <FieldError id={locationError}>{latError}</FieldError>}
            <Field label={t('placeForm.address')} error={errors.addressVi}>
              {(control) => (
                <Input
                  {...control}
                  placeholder={
                    ownerMode
                      ? t('ownerForm.addressPlaceholder')
                      : t('placeForm.addressPlaceholder')
                  }
                  lang="vi"
                  value={values.addressVi}
                  onChange={(event) => set('addressVi', event.target.value)}
                />
              )}
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t('placeForm.latitude')} required>
                {(control) => (
                  <Input
                    {...control}
                    {...located}
                    placeholder={t('placeForm.latitudePlaceholder')}
                    inputMode="decimal"
                    value={values.lat}
                    onChange={(event) => set('lat', event.target.value)}
                  />
                )}
              </Field>
              <Field label={t('placeForm.longitude')} required>
                {(control) => (
                  <Input
                    {...control}
                    {...located}
                    placeholder={t('placeForm.longitudePlaceholder')}
                    inputMode="decimal"
                    value={values.lng}
                    onChange={(event) => set('lng', event.target.value)}
                  />
                )}
              </Field>
            </div>
          </FormSection>

          <section id="photos" aria-label={t('placeForm.photos')}>
            <FormSection title={t('placeForm.photos')} badge={changed('photos')}>
              {ownerMode && ownerPlan !== null ? (
                <PhotosEditor
                  photos={values.photos}
                  onChange={(photos) => set('photos', photos)}
                  error={errors.photos}
                  max={ownerPlan.maxPhotos}
                  altPlaceholder={t('ownerForm.altPlaceholder')}
                  fileRows
                  help={t('ownerForm.photosHelp', {
                    max: ownerPlan.maxPhotos,
                    plan: ownerPlan.name,
                  })}
                  atMax={
                    <Notice
                      tone="info"
                      title={t('ownerForm.photosAtMax', {
                        n: values.photos.length,
                        max: ownerPlan.maxPhotos,
                      })}
                      action={
                        ownerPlan.next === null ? undefined : (
                          <Button asChild size="sm" variant="outline">
                            <Link href="/owner/billing/plans">{t('venues.seePlans')}</Link>
                          </Button>
                        )
                      }
                    >
                      {ownerPlan.next !== null && ownerPlan.next.maxPhotos > ownerPlan.maxPhotos
                        ? t('ownerForm.photosAtMaxNext', {
                            plan: ownerPlan.name,
                            max: ownerPlan.maxPhotos,
                            n: values.photos.length,
                            next: ownerPlan.next.name,
                            nextMax: ownerPlan.next.maxPhotos,
                          })
                        : t('ownerForm.photosAtMaxBody', {
                            plan: ownerPlan.name,
                            max: ownerPlan.maxPhotos,
                            n: values.photos.length,
                          })}
                    </Notice>
                  }
                />
              ) : (
                // Staff, or an owner whose plan couldn't be read: the API still holds the limit.
                <PhotosEditor
                  photos={values.photos}
                  onChange={(photos) => set('photos', photos)}
                  error={errors.photos}
                  {...(ownerMode
                    ? { fileRows: true, altPlaceholder: t('ownerForm.altPlaceholder') }
                    : {})}
                />
              )}
            </FormSection>
          </section>

          <section id="hours" aria-label={t('placeForm.hours')}>
            <FormSection title={t('placeForm.hours')} badge={changed('hours')}>
              <HoursEditor rows={values.hours} onChange={(hours) => set('hours', hours)} />
            </FormSection>
          </section>

          {venue ? (
            <section id="menu" aria-label={t('placeForm.menu')}>
              <FormSection title={t('placeForm.menu')} badge={changed('menu', 'menuCurrency')}>
                {ownerMode ? (
                  <Field
                    label={t('ownerForm.pricesIn')}
                    help={t('ownerForm.currencyHelp')}
                    required
                  >
                    {(control) => (
                      <Select
                        {...control}
                        value={values.menuCurrency}
                        onChange={(event) =>
                          set('menuCurrency', event.target.value === 'USD' ? 'USD' : 'VND')
                        }
                      >
                        <option value="VND">{t('ownerForm.dong')}</option>
                        <option value="USD">{t('ownerForm.dollars')}</option>
                      </Select>
                    )}
                  </Field>
                ) : null}
                <MenuEditor
                  rows={values.menu}
                  onChange={(menu) => set('menu', menu)}
                  {...(ownerMode && ownerPlan !== null
                    ? {
                        copy: {
                          price: t('ownerForm.dishPrice'),
                          dishPlaceholder: t('ownerForm.dishPlaceholder'),
                          pricePlaceholder: t('ownerForm.dishPricePlaceholder'),
                        },
                        max: ownerPlan.maxDishes,
                        atMax:
                          ownerPlan.next !== null && ownerPlan.next.maxDishes > ownerPlan.maxDishes
                            ? t('ownerForm.dishesAtMaxNext', {
                                plan: ownerPlan.name,
                                max: ownerPlan.maxDishes,
                                n: values.menu.length,
                                next: ownerPlan.next.name,
                                nextMax: ownerPlan.next.maxDishes,
                              })
                            : t('ownerForm.dishesAtMax', {
                                plan: ownerPlan.name,
                                max: ownerPlan.maxDishes,
                                n: values.menu.length,
                              }),
                      }
                    : {})}
                />
                {errors.menu === undefined ? null : (
                  <p role="alert" className="text-sm text-destructive">
                    {errors.menu}
                  </p>
                )}
              </FormSection>
            </section>
          ) : null}

          {ownerMode && ownerPlan !== null ? (
            <FormSection title={t('ownerForm.narration')}>
              <p className="text-sm text-foreground">
                {t(ownerPlan.autoNarration ? 'ownerForm.narrationAuto' : 'ownerForm.narrationTap', {
                  plan: ownerPlan.name,
                  languages: scopeLanguages(ownerPlan.scope)
                    .map((lang) => languageName(lang, locale))
                    .join(', '),
                })}{' '}
                {ownerPlan.next === null || ownerPlan.autoNarration
                  ? null
                  : t('ownerForm.narrationNext', {
                      next: ownerPlan.next.name,
                      more: scopeLanguages(ownerPlan.next.scope)
                        .filter((lang) => !scopeLanguages(ownerPlan.scope).includes(lang))
                        .map((lang) => languageName(lang, locale))
                        .join(', '),
                    })}
              </p>
            </FormSection>
          ) : null}

          {editing || ownerMode ? null : (
            <FormSection title={t('placeForm.editorial')}>
              <p className="text-sm text-muted-foreground">{t('placeForm.editorialLead')}</p>
              <SliderField
                label={t('editorial.radius')}
                placeholder={t('editorial.radiusPlaceholder')}
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
                placeholder={t('editorial.priorityPlaceholder')}
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
            {ownerMode
              ? editing
                ? t('ownerForm.editNote')
                : t('ownerForm.newNote')
              : editing
                ? t('placeForm.editNote')
                : t('placeForm.createNote')}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              dirty ? setLeaving(editing ? pageHref(place.id) : listHref) : router.back()
            }
          >
            {t('action.cancel')}
          </Button>
          {ownerMode ? (
            <Button
              type="submit"
              busy={busy === 'save' ? t('ownerForm.sending') : undefined}
              disabled={busy !== null}
            >
              {t('ownerForm.send')}
            </Button>
          ) : editing ? (
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
          const href = leaving ?? listHref;
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
