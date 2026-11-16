'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  adminSubmissionsApprove,
  adminSubmissionsGet,
  adminSubmissionsReject,
  auditLogsList,
} from '@wayfare/api-client';
import {
  DEFAULT_TRIGGER_RADIUS_M,
  MAX_TRIGGER_RADIUS_M,
  MIN_TRIGGER_RADIUS_M,
  NARRATION_PRIORITY_DEFAULT,
  NARRATION_PRIORITY_MAX,
  NARRATION_PRIORITY_MIN,
  scopeLanguages,
} from '@wayfare/contracts';
import type { NarrationLanguageScope, SubmissionEditableField } from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { SubmissionKindChip } from '@wayfare/ui/content';
import { Field, Input } from '@wayfare/ui/field';
import { PageHeader } from '@wayfare/ui/list';
import { Card, StatusBadge } from '@wayfare/ui/surfaces';
import type { StatusTone } from '@wayfare/ui/surfaces';
import { toast } from '@wayfare/ui/toaster';
import { ExternalLink, Info, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { errorText } from '../client/errors';
import { useConsole } from '../i18n/provider';
import { relativeTime } from '../notifications/text';
import { useCan } from '../shell/can';
import { useMe } from '../shell/me';
import { DecisionDialog } from './decision-dialog';
import type { DecisionNotes } from './decision-dialog';
import { insidePolygon } from './geo';
import { Facts } from './place-sections';
import { useMapStyle } from './place-page';
import { useAreas, useCategories, useNames } from './reference';
import { FieldCard, ProposalDetails } from './submission-diff';
import type { DiffColumn, PhotoSource } from './submission-diff';
import { printedCode } from './words';

type Detail = Awaited<ReturnType<typeof adminSubmissionsGet>>['data'];
type LivePlace = NonNullable<Detail['livePlace']>;

const STATUS_TONES: Record<Detail['submission']['status'], StatusTone> = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  WITHDRAWN: 'inactive',
  SUPERSEDED: 'inactive',
};

/** The live Venue's editable fields, in the payload's shape, for the *Now* column. */
function liveValues(place: LivePlace): Record<SubmissionEditableField, unknown> {
  return {
    nameVi: place.nameVi,
    descriptionVi: place.descriptionVi,
    categoryCode: place.categoryCode,
    location: place.location,
    addressVi: place.addressVi,
    priceBand: place.priceBand,
    phone: place.phone,
    websiteUrl: place.websiteUrl,
    openingHours: place.openingHours.map((row) => ({
      weekday: row.weekday ?? null,
      specificDate: row.specificDate ?? null,
      opensAt: row.isClosed ? null : (row.opensAt ?? null),
      closesAt: row.isClosed ? null : (row.closesAt ?? null),
      isClosed: row.isClosed,
    })),
    photos: place.photos.map((photo) => ({ photoId: photo.id, altTextVi: photo.altTextVi })),
    menu: { menuCurrency: place.menuCurrency, items: place.menuItems },
  };
}

/** Approve's refusals, each said inside its dialog (K11). */
const REFUSALS: Partial<Record<string, string>> = {
  PLACE_LIMIT_REACHED: 'error.PLACE_LIMIT_REACHED',
  PHOTO_LIMIT_REACHED: 'error.PHOTO_LIMIT_REACHED',
  MENU_LIMIT_REACHED: 'error.MENU_LIMIT_REACHED',
  ENTITLEMENTS_UNAVAILABLE: 'error.ENTITLEMENTS_UNAVAILABLE',
  UPSTREAM_UNAVAILABLE: 'approve.identityDown',
  UPLOAD_NOT_READY: 'approve.photoGone',
  SUBMISSION_CONFLICT: 'approve.conflict',
  LOCATION_OUTSIDE_AREAS: 'approve.outsideAreas',
  CATEGORY_NOT_APPLICABLE: 'approve.categoryOverride',
};

/**
 * A submission (S2–S6): the changed fields as cards — the unchanged folded away — beside the
 * editorial values, the owner's plan and the decision. A conflict (S3) names the fields at the top,
 * gains its *When sent* column, and keeps *Approve* off until *I've seen…* is ticked. A decision
 * someone else made first is S4b; neither decision has an Undo — the owner is told at once.
 */
/** The field cards in the Place page's order: Details' fields, Photos, Hours, Menu, Location. */
const CARD_ORDER: readonly SubmissionEditableField[] = [
  'nameVi',
  'categoryCode',
  'addressVi',
  'descriptionVi',
  'priceBand',
  'phone',
  'websiteUrl',
  'photos',
  'openingHours',
  'menu',
  'location',
];

export function SubmissionPage({ initial }: { initial: Detail }) {
  const translator = useConsole();
  const { t, tDynamic } = translator;
  const can = useCan();
  const me = useMe();
  const router = useRouter();
  const queries = useQueryClient();
  const names = useNames();
  const areas = useAreas();
  const categories = useCategories();
  const id = initial.submission.id;
  const detail = useQuery({
    queryKey: ['submission', id],
    queryFn: async () => (await adminSubmissionsGet(id)).data,
    initialData: initial,
  });
  const data = detail.data;
  const { submission, livePlace, conflict } = data;
  const payload = submission.payload as unknown as Record<SubmissionEditableField, unknown> & {
    nameVi: string;
    categoryCode: string;
    location: { lat: number; lng: number };
  };
  const creating = submission.kind === 'CREATE';
  const pending = submission.status === 'PENDING';
  const owner = data.owner?.name ?? data.owner?.email ?? t('place.aVenueOwner');
  const name = livePlace?.nameVi ?? payload.nameVi;
  const now = new Date();

  const [radius, setRadius] = useState(
    String(livePlace?.triggerRadiusM ?? DEFAULT_TRIGGER_RADIUS_M),
  );
  const [priority, setPriority] = useState(
    String(livePlace?.narrationPriority ?? NARRATION_PRIORITY_DEFAULT),
  );
  const [category, setCategory] = useState(submission.categoryCodeOverride ?? '');
  const [seen, setSeen] = useState(false);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [decided, setDecided] = useState(false);
  // Decided, here or by someone else while the page was open: nothing is editable.
  const readOnly = !pending || decided;

  const area =
    areas.data?.find((row) =>
      insidePolygon(payload.location, row.boundary.coordinates[0] as [number, number][]),
    ) ?? areas.data?.find((row) => row.id === livePlace?.areaId);
  const mapStyle = useMapStyle(area?.id ?? '');
  const photoSource: PhotoSource = (photo) =>
    photo.photoId === undefined
      ? data.uploadPreviews[photo.uploadId ?? '']
      : livePlace?.photos.find((row) => row.id === photo.photoId)?.thumb.url;

  const changed = new Set(data.diff.map((entry) => entry.field));
  const conflicted = new Set(pending ? conflict.changedFields : []);
  const live = livePlace === null ? null : liveValues(livePlace);
  const columnsOf = (field: SubmissionEditableField): DiffColumn[] => {
    const entry = data.diff.find((row) => row.field === field);
    const proposed = { label: t('submission.proposed'), value: payload[field] };
    if (creating) return [proposed];
    if (conflicted.has(field) && live !== null)
      return [
        {
          label: t('submission.whenSent'),
          value: entry === undefined ? conflict.baseValues[field] : entry.before,
        },
        {
          label: t('submission.nowWho', { who: who.data ?? t('conflict.someone') }),
          value: live[field],
        },
        proposed,
      ];
    if (entry !== undefined) return [{ label: t('submission.now'), value: entry.before }, proposed];
    return [{ label: t('submission.now'), value: payload[field] }];
  };
  // A new venue's plain fields sit in its Details card; its photos only when it has some.
  const shown = creating
    ? (['photos', 'openingHours', 'menu', 'location'] as const).filter(
        (field) => field !== 'photos' || ((payload.photos as unknown[] | null) ?? []).length > 0,
      )
    : CARD_ORDER.filter((field) => changed.has(field) || conflicted.has(field));
  const unchanged = creating
    ? []
    : CARD_ORDER.filter((field) => !changed.has(field) && !conflicted.has(field));

  // Who changed the live Place since: named only for a reader of the audit log (K11).
  const who = useQuery({
    queryKey: ['submission-conflict-who', id],
    enabled: conflicted.size > 0 && can('audit.read') && livePlace !== null,
    queryFn: async () => {
      const log = await auditLogsList({
        resourceId: livePlace!.id,
        from: submission.submittedAt,
        to: new Date().toISOString(),
        limit: 50,
      });
      const actor = log.data.find((row) => row.actor.userId !== null)?.actor;
      if (actor === undefined) return null;
      return actor.userId === me.user.id ? t('history.you') : t('history.staff');
    },
  });
  const fieldList = [...conflicted].map((field) => tDynamic(`field.${field}`)).join(', ');

  const finished = () => {
    void queries.invalidateQueries({ queryKey: ['submissions'] });
    void queries.invalidateQueries({ queryKey: ['nav-counts'] });
  };
  const refusal = async (error: unknown) => {
    if (error instanceof ApiError && error.code === 'INVALID_STATE') {
      const fresh = await detail.refetch();
      if (fresh.data?.submission.status !== 'PENDING') {
        setDialog(null);
        setDecided(true);
        return;
      }
      setAlert(t('approve.ownerNotVerified', { owner }));
      return;
    }
    const key = error instanceof ApiError ? REFUSALS[error.code] : undefined;
    setAlert(key === undefined ? errorText(error, translator) : tDynamic(key, { owner }));
  };

  const editorial = {
    triggerRadiusM: Number(radius),
    narrationPriority: Number(priority),
  };
  const radiusError =
    !Number.isInteger(editorial.triggerRadiusM) ||
    editorial.triggerRadiusM < MIN_TRIGGER_RADIUS_M ||
    editorial.triggerRadiusM > MAX_TRIGGER_RADIUS_M;
  const priorityError =
    !Number.isInteger(editorial.narrationPriority) ||
    editorial.narrationPriority < NARRATION_PRIORITY_MIN ||
    editorial.narrationPriority > NARRATION_PRIORITY_MAX;
  const [checked, setChecked] = useState(false);

  const approve = async (notes: DecisionNotes) => {
    if (busy) return;
    setBusy(true);
    setAlert(null);
    try {
      const { data: result } = await adminSubmissionsApprove(id, {
        ...editorial,
        ...(category === '' ? {} : { categoryCodeOverride: category }),
        ...notes,
        ...(conflicted.size > 0 ? { acknowledgeConflict: seen } : {}),
      });
      finished();
      toast.success(t('approve.done'));
      router.push(
        result.submission.placeId === null
          ? '/submissions'
          : `/places/${result.submission.placeId}`,
      );
    } catch (error) {
      await refusal(error);
    } finally {
      setBusy(false);
    }
  };
  const reject = async (notes: DecisionNotes) => {
    if (busy) return;
    setBusy(true);
    setAlert(null);
    try {
      await adminSubmissionsReject(id, { decisionNote: notes.decisionNote ?? '', ...notes });
      finished();
      toast.success(t('reject.done'));
      router.push('/submissions');
    } catch (error) {
      await refusal(error);
    } finally {
      setBusy(false);
    }
  };

  const proposedCategory = names.category(payload.categoryCode);
  const venueCategories = (categories.data ?? []).filter((row) => row.appliesTo !== 'EDITORIAL');
  const grants = data.entitlements;
  const languages =
    grants === null
      ? null
      : scopeLanguages(grants.narrationLanguageScope as NarrationLanguageScope);

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/submissions" className="text-sm text-muted-foreground hover:underline">
            {t('submissions.adminTitle')}
          </Link>
        }
        title={creating ? t('submission.newVenue', { name }) : t('submission.changesTo', { name })}
        badges={
          <>
            <SubmissionKindChip kind={submission.kind}>
              {tDynamic(`submissionKind.${submission.kind}`)}
            </SubmissionKindChip>
            <StatusBadge tone={STATUS_TONES[submission.status]}>
              {pending
                ? t('status.pending')
                : tDynamic(`submissionStatus.${submission.status}`, undefined, submission.status)}
            </StatusBadge>
          </>
        }
        description={[
          t('submission.sentBy', {
            owner,
            when: relativeTime(submission.submittedAt, now, translator),
          }),
          ...(livePlace === null ? [] : [printedCode(livePlace.publicCode)]),
          ...(area === undefined ? [] : [names.area(area.code)]),
        ].join(' · ')}
        action={
          livePlace === null ? undefined : (
            <Button asChild variant="outline">
              <Link href={`/places/${livePlace.id}`}>
                <ExternalLink aria-hidden />
                {t('submission.openLive')}
              </Link>
            </Button>
          )
        }
      />

      {decided ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-info px-4 py-3 text-sm text-info-foreground"
        >
          <Info aria-hidden className="size-4 shrink-0" />
          <span className="flex-1">
            <strong className="block">{t('decided.title')}</strong>
            {t('decided.body')}
          </span>
          <Button asChild variant="outline">
            <Link href="/submissions">{t('decided.back')}</Link>
          </Button>
        </div>
      ) : !pending ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-md bg-muted px-4 py-3 text-sm text-foreground"
        >
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t('decided.line', {
            decision: tDynamic(`decision.${submission.status}`, undefined, submission.status),
          })}
          {submission.decisionNote === null ? null : ` “${submission.decisionNote}”`}
        </p>
      ) : null}

      {conflicted.size > 0 ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md bg-warning px-4 py-3 text-sm text-warning-foreground"
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong className="block">{t('conflict.title', { fields: fieldList })}</strong>
            {t('conflict.body', {
              who: who.data ?? t('conflict.someone'),
              field: fieldList,
              when: livePlace === null ? '' : relativeTime(livePlace.updatedAt, now, translator),
              owner,
            })}
          </span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {creating ? (
            <>
              <p className="flex items-start gap-2 rounded-md bg-info px-4 py-3 text-sm text-info-foreground">
                <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
                {t('submission.createNote', { owner })}
              </p>
              <ProposalDetails payload={payload} />
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              {t('submission.counts', { changed: shown.length, same: unchanged.length })}
              {unchanged.length === 0 ? null : (
                <Button
                  variant="link"
                  size="sm"
                  aria-expanded={showUnchanged}
                  onClick={() => setShowUnchanged((open) => !open)}
                >
                  {showUnchanged ? t('submission.hideUnchanged') : t('submission.showUnchanged')}
                </Button>
              )}
            </div>
          )}
          {shown.map((field) => (
            <FieldCard
              key={field}
              field={field}
              columns={columnsOf(field)}
              conflict={conflicted.has(field)}
              photoSource={photoSource}
              mapStyle={mapStyle}
              note={
                field === 'descriptionVi' && !creating ? t('submission.descriptionNote') : undefined
              }
            />
          ))}
          {showUnchanged
            ? unchanged.map((field) => (
                <FieldCard
                  key={field}
                  field={field}
                  columns={columnsOf(field)}
                  conflict={false}
                  photoSource={photoSource}
                  mapStyle={mapStyle}
                />
              ))
            : null}
        </div>

        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3" aria-labelledby="editorial-values">
            <h2 id="editorial-values" className="text-lg font-semibold text-foreground">
              {t('submission.editorialValues')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('submission.editorialLead')}</p>
            <Field
              label={t('submission.radiusField')}
              required
              help={t('submission.radiusHelp', {
                m: livePlace?.triggerRadiusM ?? DEFAULT_TRIGGER_RADIUS_M,
              })}
              error={checked && radiusError ? t('editorial.radiusRange') : undefined}
            >
              {(control) => (
                <Input
                  {...control}
                  placeholder={t('editorial.radiusPlaceholder')}
                  inputMode="numeric"
                  value={radius}
                  disabled={readOnly}
                  onChange={(event) => setRadius(event.target.value)}
                />
              )}
            </Field>
            <Field
              label={t('editorial.priority')}
              required
              help={t('submission.priorityHelp', {
                p: livePlace?.narrationPriority ?? NARRATION_PRIORITY_DEFAULT,
              })}
              error={checked && priorityError ? t('editorial.priorityRange') : undefined}
            >
              {(control) => (
                <Input
                  {...control}
                  placeholder={t('editorial.priorityPlaceholder')}
                  inputMode="numeric"
                  value={priority}
                  disabled={readOnly}
                  onChange={(event) => setPriority(event.target.value)}
                />
              )}
            </Field>
            <Field label={t('place.category')} help={t('submission.categoryHelp')}>
              {(control) => (
                <select
                  {...control}
                  value={category}
                  disabled={readOnly}
                  onChange={(event) => setCategory(event.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">
                    {t('submission.asProposed', { category: proposedCategory })}
                  </option>
                  {venueCategories
                    .filter((row) => row.code !== payload.categoryCode)
                    .map((row) => (
                      <option key={row.code} value={row.code}>
                        {names.category(row.code)}
                      </option>
                    ))}
                </select>
              )}
            </Field>
          </Card>

          <Card className="flex flex-col gap-3" aria-labelledby="the-owner">
            <h2 id="the-owner" className="text-lg font-semibold text-foreground">
              {t('submission.theOwner')}
            </h2>
            <Facts
              rows={[
                [t('registration.owner'), owner],
                [
                  t('submission.autoNarration'),
                  grants === null
                    ? t('submission.unknown')
                    : grants.autoNarration
                      ? t('submission.yes')
                      : t('submission.no'),
                ],
                [
                  t('submission.languages'),
                  languages === null
                    ? t('submission.unknown')
                    : `${languages.length} (${languages.join(', ')})`,
                ],
                [
                  t('submission.venues'),
                  grants === null
                    ? t('submission.unknown')
                    : t('submission.venuesUsed', { max: grants.maxPlaces }),
                ],
              ]}
            />
          </Card>

          {readOnly ? (
            <Card className="flex flex-col gap-3" aria-labelledby="decision">
              <h2 id="decision" className="text-lg font-semibold text-foreground">
                {t('submission.decision')}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t('decided.line', {
                  decision: tDynamic(`decision.${submission.status}`, undefined, submission.status),
                })}
              </p>
            </Card>
          ) : can('submission.review') ? (
            <Card className="flex flex-col gap-3" aria-labelledby="decision">
              <h2 id="decision" className="text-lg font-semibold text-foreground">
                {t('submission.decision')}
              </h2>
              {conflicted.size > 0 ? (
                <label className="flex items-start gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={seen}
                    onChange={(event) => setSeen(event.target.checked)}
                    className="mt-0.5 size-4 accent-primary"
                  />
                  {t('conflict.ack', { field: fieldList, owner })}
                </label>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setAlert(null);
                    setDialog('reject');
                  }}
                >
                  {t('submission.reject')}
                </Button>
                <Button
                  disabled={conflicted.size > 0 && !seen}
                  onClick={() => {
                    setChecked(true);
                    if (radiusError || priorityError) return;
                    setAlert(null);
                    setDialog('approve');
                  }}
                >
                  {t('submission.approve')}
                </Button>
              </div>
            </Card>
          ) : null}
        </div>
      </div>

      <DecisionDialog
        open={dialog === 'approve'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={creating ? t('approve.titleNew', { name }) : t('approve.title', { name })}
        confirm={t('approve.confirm')}
        note={{
          label: t('approve.noteOwner'),
          help: t('approve.noteOwnerHelp', { owner }),
          placeholder: t('decision.ownerNotePlaceholder'),
        }}
        busy={busy}
        alert={alert}
        onConfirm={(notes) => void approve(notes)}
      >
        <p className="font-medium text-foreground">
          {t('approve.values', {
            m: editorial.triggerRadiusM,
            p: editorial.narrationPriority,
            category: category === '' ? proposedCategory : names.category(category),
          })}
        </p>
        <p>{t('approve.next', { name })}</p>
        <p>{t('approve.told', { owner })}</p>
      </DecisionDialog>
      <DecisionDialog
        open={dialog === 'reject'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t('reject.title', { name })}
        confirm={t('reject.confirm')}
        reject
        note={{
          label: t('approve.noteOwner'),
          help: t('reject.noteHelp', { owner }),
          placeholder: t('decision.ownerNotePlaceholder'),
        }}
        busy={busy}
        alert={alert}
        onConfirm={(notes) => void reject(notes)}
      >
        <p>{t('reject.body', { name, owner })}</p>
      </DecisionDialog>
    </>
  );
}
