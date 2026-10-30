'use client';

import { keepPreviousData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminPronunciationsList,
  adminPronunciationsRemove,
  adminPronunciationsUpdate,
} from '@wayfare/api-client';
import type { PronunciationEntryResponseDto } from '@wayfare/api-client';
import { SOURCE_LANGUAGE, SUPPORTED_LANGUAGES } from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { DestructiveDialog } from '@wayfare/ui/dialogs';
import { DataList, ListCard, LoadMore, PageHeader, SearchField } from '@wayfare/ui/list';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@wayfare/ui/menu';
import { mergeCursorPages } from '@wayfare/ui/paging';
import { EmptyState } from '@wayfare/ui/states';
import { StatusBadge } from '@wayfare/ui/surfaces';
import { toast } from '@wayfare/ui/toaster';
import { Ellipsis, Plus, SearchX, Speech } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { errorText, failureOf } from '../client/errors';
import { ClearFilters, Filter } from '../components/filter';
import { formatDate } from '../i18n/format';
import { autonym } from '../i18n/language-names';
import { useConsole } from '../i18n/provider';
import { useMe } from '../shell/me';
import { ErrorView } from '../states/states';

type Entry = PronunciationEntryResponseDto;

/** The languages an entry may name: every served one but the source. */
export const ENTRY_LANGUAGES = SUPPORTED_LANGUAGES.filter((code) => code !== SOURCE_LANGUAGE);
const PAGE_SIZE = 20;

/** Who changed something (K1): "You", the name for a reader holding `user.read`, else "A staff member". */
export function useWho() {
  const { t } = useConsole();
  const me = useMe();
  return (person: { id: string; name: string | null }) =>
    person.id === me.user.id ? t('history.you') : (person.name ?? t('history.staff'));
}

/** The dictionary, frames D1 and D1m: search by term, a language filter, cursor paging (K8, K15). */
export function Pronunciation() {
  const translator = useConsole();
  const { t, locale } = translator;
  const queries = useQueryClient();
  const who = useWho();
  // D2b's link opens the dictionary searched on the term.
  const [search, setSearch] = useState(useSearchParams().get('q') ?? '');
  const [language, setLanguage] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Entry | null>(null);
  const [busy, setBusy] = useState(false);
  const params = {
    limit: PAGE_SIZE,
    ...(search.trim().length < 2 ? {} : { q: search.trim() }),
    ...(language === null ? {} : { targetLang: language }),
  };
  const list = useInfiniteQuery({
    queryKey: ['pronunciations', params],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      adminPronunciationsList({
        ...params,
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
      }),
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
  const rows =
    list.data === undefined
      ? undefined
      : mergeCursorPages(list.data.pages.map((page) => page.data));
  const filtered = search !== '' || language !== null;
  const refresh = () => void queries.invalidateQueries({ queryKey: ['pronunciations'] });
  const clear = () => {
    setSearch('');
    setLanguage(null);
  };

  const setActive = (entry: Entry, isActive: boolean) =>
    void adminPronunciationsUpdate(entry.id, { isActive }).then(
      () => {
        toast.success(isActive ? t('pron.activated') : t('pron.deactivated'));
        refresh();
      },
      (error: unknown) => toast.error(errorText(error, translator), { duration: Infinity }),
    );
  const remove = (entry: Entry) => {
    setBusy(true);
    adminPronunciationsRemove(entry.id).then(
      () => {
        setBusy(false);
        setDeleting(null);
        toast.success(t('pronDelete.done'));
        refresh();
      },
      (error: unknown) => {
        setBusy(false);
        toast.error(errorText(error, translator), { duration: Infinity });
      },
    );
  };

  const term = (entry: Entry) => (
    <Link
      href={`/narration/pronunciation/${entry.id}`}
      lang="vi"
      className="font-medium text-foreground hover:underline"
    >
      {entry.term}
    </Link>
  );
  const lang = (entry: Entry) =>
    entry.targetLang === null ? (
      t('pron.allLanguages')
    ) : (
      <span lang={entry.targetLang}>{autonym(entry.targetLang)}</span>
    );
  const says = (entry: Entry) => (
    <span className="flex flex-col">
      <span>{entry.replacement}</span>
      <span className="text-xs text-muted-foreground">
        {entry.replacementType === 'SUB'
          ? t('pron.alias')
          : t('pron.phonemeIn', { alphabet: entry.alphabet === 'x-sampa' ? 'X-SAMPA' : 'IPA' })}
      </span>
    </span>
  );
  const status = (entry: Entry) =>
    entry.isActive ? (
      <StatusBadge tone="active">{t('pron.active')}</StatusBadge>
    ) : (
      <StatusBadge tone="inactive">{t('pron.inactive')}</StatusBadge>
    );
  const changed = (entry: Entry) => (
    <span className="flex flex-col whitespace-nowrap">
      <span>{formatDate(entry.updatedAt, locale)}</span>
      <span className="text-xs text-muted-foreground">
        {t('pron.by', { who: who(entry.updatedBy) })}
      </span>
    </span>
  );
  const menu = (entry: Entry) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('pron.rowMenu', { term: entry.term })}>
          <Ellipsis aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/narration/pronunciation/${entry.id}`}>{t('pron.edit')}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setActive(entry, !entry.isActive)}>
          {entry.isActive ? t('pron.deactivate') : t('pron.activate')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive" onSelect={() => setDeleting(entry)}>
          {t('pron.delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
      <PageHeader
        title={t('pron.title')}
        description={t('pron.lead')}
        action={
          <Button asChild>
            <Link href="/narration/pronunciation/new">
              <Plus aria-hidden />
              {t('pron.new')}
            </Link>
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          aria-label={t('pron.search')}
          placeholder={t('pron.search')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Filter
          name={t('pron.language')}
          allLabel={t('pron.all')}
          value={language}
          options={ENTRY_LANGUAGES.map((code) => ({ value: code, label: autonym(code) }))}
          onChange={setLanguage}
        />
        {filtered ? <ClearFilters label={t('pron.clearFilters')} onClear={clear} /> : null}
      </div>
      {list.isError ? (
        <ErrorView failure={failureOf(list.error)} onRetry={() => void list.refetch()} />
      ) : rows !== undefined && rows.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={<SearchX />}
            title={t('pron.noResultsTitle')}
            body={t('pron.noResultsBody')}
            action={
              <Button variant="outline" onClick={clear}>
                {t('pron.clearFilters')}
              </Button>
            }
          />
        ) : (
          <EmptyState icon={<Speech />} title={t('pron.emptyTitle')} body={t('pron.emptyBody')} />
        )
      ) : (
        <>
          <DataList
            caption={t('pron.title')}
            columns={[
              { key: 'term', label: t('pron.term') },
              { key: 'language', label: t('pron.language') },
              { key: 'says', label: t('pron.saysAs') },
              { key: 'note', label: t('pron.note') },
              { key: 'status', label: t('pron.status') },
              { key: 'changed', label: t('pron.changed') },
            ]}
            rows={rows}
            rowKey={(entry) => entry.id}
            cell={(entry, column) => {
              switch (column) {
                case 'term':
                  return term(entry);
                case 'language':
                  return lang(entry);
                case 'says':
                  return says(entry);
                case 'note':
                  return <span className="text-muted-foreground">{entry.note ?? ''}</span>;
                case 'status':
                  return status(entry);
                default:
                  return changed(entry);
              }
            }}
            card={(entry) => (
              <ListCard
                name={term(entry)}
                status={status(entry)}
                facts={
                  <>
                    {lang(entry)} ·{' '}
                    {t('pron.cardSays', {
                      text: entry.replacement,
                      kind:
                        entry.replacementType === 'SUB'
                          ? t('pron.alias').toLocaleLowerCase(locale)
                          : entry.alphabet === 'x-sampa'
                            ? 'X-SAMPA'
                            : 'IPA',
                    })}
                  </>
                }
                time={t('pron.cardChanged', {
                  date: formatDate(entry.updatedAt, locale),
                  who: who(entry.updatedBy),
                })}
              />
            )}
            rowEnd={{ label: t('pron.rowActions'), render: menu }}
          />
          {list.hasNextPage ? (
            <LoadMore
              label={t('pron.loadMore')}
              busy={list.isFetchingNextPage ? t('pron.loadMore') : undefined}
              onLoad={() => void list.fetchNextPage()}
            />
          ) : null}
        </>
      )}
      {deleting === null ? null : (
        <DeleteEntry
          entry={deleting}
          busy={busy}
          onOpenChange={() => setDeleting(null)}
          onDelete={remove}
        />
      )}
    </>
  );
}

/** Delete, frame D5: destructive, no Undo; deactivating is the row's other way (K17). */
export function DeleteEntry<T extends { term: string }>({
  entry,
  busy,
  onOpenChange,
  onDelete,
}: {
  entry: T;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: (entry: T) => void;
}) {
  const { t } = useConsole();
  return (
    <DestructiveDialog
      open
      onOpenChange={onOpenChange}
      title={t('pronDelete.title', { term: entry.term })}
      description={t('pronDelete.body', { term: entry.term })}
      confirm={t('pronDelete.confirm')}
      busy={busy ? t('pronDelete.confirm') : undefined}
      labels={{ cancel: t('action.cancel'), close: t('action.close') }}
      name={entry.term}
      typeLabel={t('pronDelete.type', { term: entry.term })}
      onConfirm={() => onDelete(entry)}
    />
  );
}
