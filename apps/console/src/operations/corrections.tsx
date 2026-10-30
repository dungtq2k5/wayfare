'use client';

import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  adminCorrectionsList,
  adminLocalizationsOverview,
  adminLocalizationsPut,
  adminLocalizationsRevert,
  adminPlacesList,
  ApiError,
} from '@wayfare/api-client';
import type {
  CorrectionListItemResponseDto,
  LocalizationOverviewResponseDto,
} from '@wayfare/api-client';
import { MAX_DESCRIPTION_CHARS, MAX_PLACE_NAME_LENGTH, zCorrectionInput } from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { ConfirmDialog, LeaveDialog } from '@wayfare/ui/dialogs';
import { Field, FormAlert, Input, Textarea } from '@wayfare/ui/field';
import { SaveBar, useLeaveGuard } from '@wayfare/ui/form';
import {
  DataList,
  ListCard,
  LoadMore,
  PageHeader,
  RowChevron,
  SearchField,
} from '@wayfare/ui/list';
import { mergeCursorPages } from '@wayfare/ui/paging';
import { EmptyState } from '@wayfare/ui/states';
import { Card, StatusBadge } from '@wayfare/ui/surfaces';
import { toast } from '@wayfare/ui/toaster';
import { ExternalLink, FileText, Languages, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { errorText, failureOf } from '../client/errors';
import { Filter } from '../components/filter';
import { validateForm } from '../forms/field-errors';
import type { FieldErrors } from '../forms/field-errors';
import { formatDate } from '../i18n/format';
import { autonym } from '../i18n/language-names';
import { useConsole } from '../i18n/provider';
import { printedCode } from '../content/words';
import { ErrorView } from '../states/states';
import { useWho } from './pronunciation';

type Overview = LocalizationOverviewResponseDto;
type Language = Overview['languages'][number];
type Item = CorrectionListItemResponseDto;
export type TargetType = Overview['targetType'];

const SHOWS = ['REVIEW_FIRST', 'RECENT'] as const;
const PAGE_SIZE = 20;
const targetHref = (type: string, id: string) => `/narration/corrections/${type}/${id}`;

/** A correction's state chip: in use, or superseded and waiting for review (T1, T2). */
function CorrectionChip({ review }: { review: boolean }) {
  const { t } = useConsole();
  return review ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-warning px-2 py-0.5 text-xs font-medium text-warning-foreground">
      <TriangleAlert aria-hidden className="size-3" />
      {t('corr.superseded')}
    </span>
  ) : (
    <StatusBadge tone="active">{t('corr.inUse')}</StatusBadge>
  );
}

/**
 * Translation corrections (T1): a Place search, and the corrections across targets, superseded
 * ones first or the newest (K10, K18).
 */
export function Corrections() {
  const translator = useConsole();
  const { t, tDynamic, locale } = translator;
  const who = useWho();
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<(typeof SHOWS)[number]>('REVIEW_FIRST');
  const query = search.trim();
  const places = useQuery({
    queryKey: ['correction-places', query],
    queryFn: async () => (await adminPlacesList({ q: query, pageSize: 10 })).data,
    enabled: query.length > 0,
    placeholderData: keepPreviousData,
  });
  const list = useInfiniteQuery({
    queryKey: ['corrections', show],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      adminCorrectionsList({
        show,
        limit: PAGE_SIZE,
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
      }),
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  });
  const rows =
    list.data === undefined
      ? undefined
      : mergeCursorPages(
          list.data.pages.map((page) =>
            page.data.map((item) => ({ ...item, id: item.correction.id })),
          ),
        );

  const target = (item: Item) => (
    <Link
      href={targetHref(item.correction.targetType, item.correction.targetId)}
      className="flex flex-col hover:underline"
    >
      <span lang="vi" className="font-medium text-foreground">
        {item.targetNameVi}
      </span>
      <span className="text-xs text-muted-foreground">
        {tDynamic(`corr.kind.${item.correction.targetType}`)}
      </span>
    </Link>
  );
  const corrected = (item: Item) => (
    <span className="flex flex-col whitespace-nowrap">
      <span>{formatDate(item.correction.updatedAt, locale)}</span>
      <span className="text-xs text-muted-foreground">
        {t('pron.by', { who: who(item.editedBy) })}
      </span>
    </span>
  );

  return (
    <>
      <PageHeader title={t('corr.title')} description={t('corr.lead')} />
      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          aria-label={t('corr.find')}
          placeholder={t('corr.find')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Filter
          name={t('corr.shows')}
          value={show}
          options={SHOWS.map((value) => ({ value, label: tDynamic(`corr.show.${value}`) }))}
          onChange={(value) => setShow((value ?? 'REVIEW_FIRST') as (typeof SHOWS)[number])}
        />
      </div>
      {query === '' ? null : (
        <section aria-labelledby="correction-places" className="flex flex-col gap-3">
          <h2 id="correction-places" className="text-lg font-semibold text-foreground">
            {t('corr.places')}
          </h2>
          {places.data !== undefined && places.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('corr.noPlaces')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
              {(places.data ?? []).map((place) => (
                <li key={place.id}>
                  <Link
                    href={targetHref('PLACE', place.id)}
                    className="flex items-center justify-between gap-2 px-4 py-3 hover:bg-muted"
                  >
                    <span className="flex flex-col">
                      <span lang="vi" className="font-medium text-foreground">
                        {place.nameVi}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t('corr.kind.PLACE')} · {printedCode(place.publicCode)}
                      </span>
                    </span>
                    <RowChevron />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <h2 className="text-lg font-semibold text-foreground">{tDynamic(`corr.show.${show}`)}</h2>
      {list.isError ? (
        <ErrorView failure={failureOf(list.error)} onRetry={() => void list.refetch()} />
      ) : rows !== undefined && rows.length === 0 ? (
        <EmptyState icon={<Languages />} title={t('corr.emptyTitle')} body={t('corr.emptyBody')} />
      ) : (
        <>
          <DataList
            caption={t('corr.title')}
            columns={[
              { key: 'target', label: t('corr.target') },
              { key: 'language', label: t('corr.language') },
              { key: 'correction', label: t('corr.correction') },
              { key: 'corrected', label: t('corr.corrected') },
            ]}
            rows={rows}
            rowKey={(item) => item.correction.id}
            cell={(item, column) => {
              switch (column) {
                case 'target':
                  return target(item);
                case 'language':
                  return <span lang={item.correction.lang}>{autonym(item.correction.lang)}</span>;
                case 'correction':
                  return <CorrectionChip review={item.needsReview} />;
                default:
                  return corrected(item);
              }
            }}
            card={(item) => (
              <ListCard
                name={target(item)}
                status={<CorrectionChip review={item.needsReview} />}
                facts={autonym(item.correction.lang)}
                time={corrected(item)}
              />
            )}
            rowEnd={{ label: t('corr.rowActions'), render: () => <RowChevron /> }}
          />
          {list.hasNextPage ? (
            <LoadMore
              label={t('corr.loadMore')}
              busy={list.isFetchingNextPage ? t('corr.loadMore') : undefined}
              onLoad={() => void list.fetchNextPage()}
            />
          ) : null}
        </>
      )}
    </>
  );
}

/** A target's overview, read again in the browser after a change. */
function useOverview(initial: Overview) {
  return useQuery({
    queryKey: ['localizations', initial.targetType, initial.targetId],
    queryFn: async () =>
      (await adminLocalizationsOverview(initial.targetType, initial.targetId)).data,
    initialData: initial,
  });
}

/** Where the target is edited: a Place's own page (dishes and tours are a Place's too). */
const placeHref = (overview: Overview) =>
  overview.targetType === 'PLACE' ? `/places/${overview.targetId}` : null;

/**
 * A target's languages (T2): the source, then each language with the text in use — machine or a
 * correction — its audio, and *Correct*, *Edit correction* or, when superseded, *Review*.
 */
export function TargetLanguages({ initial }: { initial: Overview }) {
  const { t, tDynamic, locale } = useConsole();
  const who = useWho();
  const overview = useOverview(initial).data;
  const place = placeHref(overview);
  const rows = [...overview.languages].sort((a, b) =>
    a.lang === 'vi' ? -1 : b.lang === 'vi' ? 1 : 0,
  );
  const base = targetHref(overview.targetType, overview.targetId);

  const text = (row: Language) => {
    if (row.lang === 'vi') return <span className="text-muted-foreground">{t('corr.source')}</span>;
    if (row.correction !== null && row.needsReview)
      return (
        <span className="flex flex-col items-start gap-1">
          <CorrectionChip review />
          <span className="text-xs text-muted-foreground">{t('corr.supersededLine')}</span>
        </span>
      );
    if (row.correction !== null)
      return (
        <span className="flex flex-col items-start gap-1">
          <StatusBadge tone="active">{t('corr.correctionChip')}</StatusBadge>
          <span className="text-xs text-muted-foreground">
            {t('corr.byWhen', {
              who: who({ id: row.correction.editedById, name: null }),
              date: formatDate(row.correction.updatedAt, locale),
            })}
          </span>
        </span>
      );
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        <FileText aria-hidden className="size-3" />
        {t('corr.machine')}
      </span>
    );
  };
  const action = (row: Language) => {
    if (row.lang === 'vi')
      return place === null ? null : (
        <Button asChild variant="link" size="sm">
          <Link href={`${place}/edit`}>{t('corr.editOnPlace')}</Link>
        </Button>
      );
    const href = `${base}/${row.lang}`;
    if (row.correction !== null && row.needsReview)
      return (
        <Button asChild size="sm">
          <Link href={href}>{t('corr.review')}</Link>
        </Button>
      );
    return (
      <Button asChild variant="outline" size="sm">
        <Link href={href}>
          {row.correction !== null ? t('corr.editCorrection') : t('corr.correct')}
        </Link>
      </Button>
    );
  };
  const language = (row: Language) => (
    <span lang={row.lang} className="font-medium whitespace-nowrap text-foreground">
      {row.lang === 'vi' ? t('corr.sourceLabel', { language: autonym('vi') }) : autonym(row.lang)}
    </span>
  );

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link
            href="/narration/corrections"
            className="text-sm text-muted-foreground hover:underline"
          >
            {t('corr.title')}
          </Link>
        }
        title={overview.nameVi}
        description={tDynamic(`corr.kind.${overview.targetType}`)}
        action={
          place === null ? undefined : (
            <Button asChild variant="outline">
              <Link href={place}>
                <ExternalLink aria-hidden />
                {t('corr.openPlace')}
              </Link>
            </Button>
          )
        }
      />
      <DataList
        caption={overview.nameVi}
        columns={[
          { key: 'language', label: t('corr.language') },
          { key: 'text', label: t('corr.textInUse') },
          { key: 'audio', label: t('corr.audio') },
        ]}
        rows={rows}
        rowKey={(row) => row.lang}
        cell={(row, column) => {
          switch (column) {
            case 'language':
              return language(row);
            case 'text':
              return text(row);
            default:
              return tDynamic(`corr.audio.${row.audioStatus}`, undefined, t('corr.audio.NONE'));
          }
        }}
        card={(row) => (
          <ListCard
            name={language(row)}
            status={text(row)}
            facts={tDynamic(`corr.audio.${row.audioStatus}`, undefined, t('corr.audio.NONE'))}
            time={null}
          />
        )}
        rowEnd={{ label: t('corr.rowActions'), render: action }}
      />
    </>
  );
}

/**
 * Correct a language (T3–T4): the Vietnamese read-only beside the language's fields. A `409`
 * keeps the typed text and *Reload the Vietnamese* sends the new hash on the next save; a
 * superseded correction is the starting point of its review (T3c).
 */
export function CorrectionEditor({ initial, lang }: { initial: Overview; lang: string }) {
  const translator = useConsole();
  const { t } = translator;
  const router = useRouter();
  const queries = useQueryClient();
  const overview = useOverview(initial);
  const [source, setSource] = useState(initial);
  const row = source.languages.find((language) => language.lang === lang);
  const start = {
    name: row?.correction?.name ?? row?.name ?? '',
    description: row?.correction?.description ?? row?.description ?? '',
  };
  const [values, setValues] = useState(start);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [changed, setChanged] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const base = targetHref(source.targetType, source.targetId);
  const dirty = !saved && (values.name !== start.name || values.description !== start.description);
  useLeaveGuard(dirty && leaving === null && !busy, setLeaving);
  const language = autonym(lang);
  const stale = row?.correction != null && row.needsReview;

  const done = (message: string, description?: string) => {
    setSaved(true);
    void queries.invalidateQueries({ queryKey: ['localizations'] });
    void queries.invalidateQueries({ queryKey: ['corrections'] });
    toast.success(message, description === undefined ? undefined : { description });
    router.push(base);
  };
  const save = () => {
    const body = {
      sourceContentHash: source.sourceContentHash,
      name: values.name,
      description: values.description.trim() === '' ? null : values.description,
    };
    const checked = validateForm(zCorrectionInput, body, translator);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setAlert(null);
    setBusy(true);
    adminLocalizationsPut(source.targetType, source.targetId, lang, body).then(
      () => {
        setBusy(false);
        done(t('corrEdit.saved'), t('corrEdit.savedBody'));
      },
      (error: unknown) => {
        setBusy(false);
        if (error instanceof ApiError && error.code === 'LOCALIZATION_SOURCE_CHANGED')
          setChanged(true);
        else setAlert(errorText(error, translator));
      },
    );
  };
  const reload = () =>
    void overview.refetch().then((result) => {
      if (result.data !== undefined) setSource(result.data);
      setChanged(false);
    });
  const revert = () => {
    setBusy(true);
    adminLocalizationsRevert(source.targetType, source.targetId, lang).then(
      () => {
        setBusy(false);
        setReverting(false);
        done(t('corrEdit.reverted'));
      },
      (error: unknown) => {
        setBusy(false);
        setReverting(false);
        setAlert(errorText(error, translator));
      },
    );
  };

  return (
    <>
      <PageHeader
        breadcrumb={
          <span className="text-sm text-muted-foreground">
            <Link href="/narration/corrections" className="hover:underline">
              {t('corr.title')}
            </Link>
            {' / '}
            <Link href={base} lang="vi" className="hover:underline">
              {source.nameVi}
            </Link>
          </span>
        }
        title={t('corrEdit.title', { language })}
      />
      <form
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        {changed ? (
          <FormAlert
            action={
              <Button type="button" variant="outline" size="sm" onClick={reload}>
                {t('corrEdit.reload')}
              </Button>
            }
          >
            <strong className="block">{t('corrEdit.changedTitle')}</strong>
            <span className="block">{t('corrEdit.changedBody')}</span>
          </FormAlert>
        ) : stale ? (
          <div
            role="status"
            className="flex items-start gap-2 rounded-md border border-warning-foreground bg-warning px-4 py-3 text-sm text-warning-foreground"
          >
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>
              <strong className="block">{t('corrEdit.staleTitle')}</strong>
              {t('corrEdit.staleBody')}
            </span>
          </div>
        ) : alert === null ? null : (
          <FormAlert>{alert}</FormAlert>
        )}
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <Card className="flex flex-col gap-4" aria-labelledby="correction-source" lang="vi">
            <h2 id="correction-source" className="text-lg font-semibold text-foreground">
              {t('corr.sourceLabel', { language: autonym('vi') })}
            </h2>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
              <dt className="text-muted-foreground">{t('corrEdit.name')}</dt>
              <dd className="text-foreground sm:col-span-3">{source.nameVi}</dd>
              {source.descriptionVi === null ? null : (
                <>
                  <dt className="text-muted-foreground">{t('corrEdit.description')}</dt>
                  <dd className="whitespace-pre-line text-foreground sm:col-span-3">
                    {source.descriptionVi}
                  </dd>
                </>
              )}
            </dl>
          </Card>
          <Card className="flex flex-col gap-4" aria-labelledby="correction-target">
            <h2
              id="correction-target"
              lang={lang}
              className="text-lg font-semibold text-foreground"
            >
              {language}
            </h2>
            <Field
              label={t('corrEdit.name')}
              required
              help={t('corrEdit.nameHelp', { max: MAX_PLACE_NAME_LENGTH })}
              error={errors.name}
            >
              {(control) => (
                <Input
                  {...control}
                  lang={lang}
                  value={values.name}
                  onChange={(event) => setValues((now) => ({ ...now, name: event.target.value }))}
                />
              )}
            </Field>
            {source.descriptionVi === null ? null : (
              <Field
                label={t('corrEdit.description')}
                required
                help={t('corrEdit.descriptionHelp', {
                  max: MAX_DESCRIPTION_CHARS,
                  count: values.description.trim().length,
                })}
                error={errors.description}
              >
                {(control) => (
                  <Textarea
                    {...control}
                    lang={lang}
                    rows={10}
                    value={values.description}
                    onChange={(event) =>
                      setValues((now) => ({ ...now, description: event.target.value }))
                    }
                  />
                )}
              </Field>
            )}
            <p className="text-sm text-muted-foreground">{t('corrEdit.together', { language })}</p>
          </Card>
        </div>
        <SaveBar>
          <Button
            type="button"
            variant="outline"
            onClick={() => (dirty ? setLeaving(base) : router.push(base))}
          >
            {t('action.cancel')}
          </Button>
          {row?.correction == null ? null : (
            <Button type="button" variant="outline" onClick={() => setReverting(true)}>
              {t('corrEdit.revert')}
            </Button>
          )}
          <Button type="submit" busy={busy ? t('action.saving') : undefined}>
            {t('corrEdit.save')}
          </Button>
        </SaveBar>
      </form>
      <ConfirmDialog
        open={reverting}
        onOpenChange={setReverting}
        title={t('corrEdit.revertTitle', { language })}
        description={t('corrEdit.revertBody')}
        confirm={t('corrEdit.revert')}
        busy={busy ? t('corrEdit.revert') : undefined}
        labels={{ cancel: t('action.cancel'), close: t('action.close') }}
        onConfirm={revert}
      />
      <LeaveDialog
        open={leaving !== null}
        onOpenChange={(open) => !open && setLeaving(null)}
        title={t('leave.title')}
        description={t('leave.body', { name: t('corrEdit.title', { language }) })}
        stay={t('leave.stay')}
        leave={t('leave.leave')}
        closeLabel={t('action.close')}
        onLeave={() => {
          setSaved(true);
          router.push(leaving ?? base);
        }}
      />
    </>
  );
}
