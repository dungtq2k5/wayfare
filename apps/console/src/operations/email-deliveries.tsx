'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { adminUsersCheckEmailDelivery, adminUsersEmailDeliveries } from '@wayfare/api-client';
import type { EmailDeliveryResponseDto } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { Field, FormAlert, Input } from '@wayfare/ui/field';
import { DataList, ListCard, LoadMore, PageHeader } from '@wayfare/ui/list';
import { mergeCursorPages } from '@wayfare/ui/paging';
import { StatusBadge } from '@wayfare/ui/surfaces';
import type { StatusTone } from '@wayfare/ui/surfaces';
import { CircleCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { errorText, failureOf } from '../client/errors';
import { useConsole } from '../i18n/provider';
import { ErrorView } from '../states/states';
import { dateTime } from './user-page';
import type { UserView } from './user-page';

type Delivery = EmailDeliveryResponseDto;
const PAGE_SIZE = 20;
const TONE: Record<Delivery['status'], StatusTone> = {
  QUEUED: 'pending',
  SENT: 'processing',
  DELIVERED: 'active',
  BOUNCED: 'rejected',
  COMPLAINED: 'rejected',
  FAILED: 'rejected',
};

/**
 * Email deliveries (U8): *Check an address* — whether the deliveries went to it, each check
 * recorded — then what was sent, masked, newest first. Never a body, a subject or a link.
 */
export function EmailDeliveries({ user }: { user: UserView }) {
  const translator = useConsole();
  const { t, tDynamic, locale } = translator;
  const name = user.fullName ?? user.email;
  const list = useInfiniteQuery({
    queryKey: ['deliveries', user.id],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      adminUsersEmailDeliveries(user.id, {
        limit: PAGE_SIZE,
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
      }),
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  });
  const rows =
    list.data === undefined
      ? undefined
      : mergeCursorPages(list.data.pages.map((page) => page.data));
  const [address, setAddress] = useState('');
  const [answer, setAnswer] = useState<{ email: string; matches: boolean } | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = () => {
    const email = address.trim();
    if (email === '') return;
    setBusy(true);
    setAlert(null);
    adminUsersCheckEmailDelivery(user.id, { email }).then(
      ({ data }) => {
        setBusy(false);
        setAnswer({ email, matches: data.matches });
      },
      (error: unknown) => {
        setBusy(false);
        setAlert(errorText(error, translator));
      },
    );
  };

  const status = (row: Delivery) => (
    <span className="flex flex-col items-start gap-1">
      <StatusBadge tone={TONE[row.status]}>
        {tDynamic(`deliveries.status.${row.status}`)}
      </StatusBadge>
      {row.bounceType === null ? null : (
        <span className="text-xs text-muted-foreground">
          {tDynamic(`deliveries.bounce.${row.bounceType}`)}
        </span>
      )}
    </span>
  );
  const when = (row: Delivery) => (
    <span className="flex flex-col whitespace-nowrap">
      <span className="text-xs text-muted-foreground">
        {t('deliveries.queuedAt', { time: dateTime(row.createdAt, locale) })}
      </span>
      {row.status === 'QUEUED' ? null : (
        <span className="text-xs text-muted-foreground">
          {t('deliveries.statusAt', {
            status: tDynamic(`deliveries.status.${row.status}`),
            time: dateTime(row.statusChangedAt, locale),
          })}
        </span>
      )}
    </span>
  );

  return (
    <>
      <PageHeader
        breadcrumb={
          <span className="text-sm text-muted-foreground">
            <Link href="/users" className="hover:underline">
              {t('users.title')}
            </Link>
            {' / '}
            <Link href={`/users/${user.id}`} className="hover:underline">
              {name}
            </Link>
          </span>
        }
        title={t('deliveries.title')}
        description={t('deliveries.lead', { name })}
      />
      <section
        aria-labelledby="address-check"
        className="flex max-w-2xl flex-col gap-3 rounded-lg border border-border bg-card p-6"
      >
        <h2 id="address-check" className="text-lg font-semibold text-foreground">
          {t('deliveries.check')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('deliveries.checkLead')}</p>
        <form
          noValidate
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            check();
          }}
        >
          <Field label={t('deliveries.address')} required className="min-w-64 flex-1">
            {(control) => (
              <Input
                {...control}
                type="email"
                autoComplete="off"
                value={address}
                onChange={(event) => {
                  setAddress(event.target.value);
                  setAnswer(null);
                }}
              />
            )}
          </Field>
          <Button
            type="submit"
            variant="outline"
            busy={busy ? t('deliveries.checkButton') : undefined}
          >
            {t('deliveries.checkButton')}
          </Button>
        </form>
        <p role="status" className="text-sm">
          {answer === null ? null : answer.matches ? (
            <span className="inline-flex items-center gap-1 text-success-foreground">
              <CircleCheck aria-hidden className="size-4" />
              {t('deliveries.matches', { email: answer.email })}
            </span>
          ) : (
            <span className="text-foreground">
              {t('deliveries.noMatch', { email: answer.email })}
            </span>
          )}
        </p>
        {alert === null ? null : <FormAlert>{alert}</FormAlert>}
      </section>
      {list.isError ? (
        <ErrorView failure={failureOf(list.error)} onRetry={() => void list.refetch()} />
      ) : rows !== undefined && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('deliveries.empty')}</p>
      ) : (
        <>
          <DataList
            caption={t('deliveries.title')}
            columns={[
              { key: 'template', label: t('deliveries.template') },
              { key: 'to', label: t('deliveries.sentTo') },
              { key: 'status', label: t('deliveries.status') },
              { key: 'when', label: t('deliveries.when') },
            ]}
            rows={rows}
            rowKey={(row) => row.id}
            cell={(row, column) => {
              switch (column) {
                case 'template':
                  return tDynamic(`template.${row.template}`);
                case 'to':
                  return <span>{row.toEmailMasked ?? '—'}</span>;
                case 'status':
                  return status(row);
                default:
                  return when(row);
              }
            }}
            card={(row) => (
              <ListCard
                name={tDynamic(`template.${row.template}`)}
                status={status(row)}
                facts={row.toEmailMasked ?? '—'}
                time={when(row)}
              />
            )}
          />
          {list.hasNextPage ? (
            <LoadMore
              label={t('deliveries.loadMore')}
              busy={list.isFetchingNextPage ? t('deliveries.loadMore') : undefined}
              onLoad={() => void list.fetchNextPage()}
            />
          ) : null}
        </>
      )}
    </>
  );
}
