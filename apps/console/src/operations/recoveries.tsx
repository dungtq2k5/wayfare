'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminRecoveriesApprove,
  adminRecoveriesGet,
  adminRecoveriesList,
  adminRecoveriesOpenRecovery,
  adminRecoveriesReject,
  ApiError,
  auditLogsList,
} from '@wayfare/api-client';
import type { AdminRecoveriesListParams, RecoveryResponseDto } from '@wayfare/api-client';
import {
  MAX_RECOVERY_DECISION_NOTE_LENGTH,
  MAX_SUPPORT_REFERENCE_LENGTH,
  RECOVERY_EVIDENCE_CODES,
} from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { ConfirmDialog, ReasonDialog } from '@wayfare/ui/dialogs';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@wayfare/ui/dialog';
import { Field, FieldError, FormAlert, Input } from '@wayfare/ui/field';
import { DataList, ListCard, PageHeader, Pagination, RowChevron } from '@wayfare/ui/list';
import { EmptyState } from '@wayfare/ui/states';
import { Card, StatusBadge } from '@wayfare/ui/surfaces';
import type { StatusTone } from '@wayfare/ui/surfaces';
import { Timeline, TimelineItem } from '@wayfare/ui/timeline';
import type { TimelineState } from '@wayfare/ui/timeline';
import { toast } from '@wayfare/ui/toaster';
import { Info, LifeBuoy } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { errorText, failureOf } from '../client/errors';
import { EmailAddress } from '../components/email-address';
import { Filter } from '../components/filter';
import { Facts } from '../content/place-sections';
import { formatDate } from '../i18n/format';
import type { Translator } from '../i18n/messages';
import { useConsole } from '../i18n/provider';
import { useCan } from '../shell/can';
import { useMe } from '../shell/me';
import { ErrorView } from '../states/states';
import type { Subject } from './user-dialogs';
import { dateTime } from './user-page';

type Recovery = RecoveryResponseDto;
type Status = Recovery['status'];
const STATUSES: readonly Status[] = [
  'PENDING_APPROVAL',
  'ON_HOLD',
  'LINK_SENT',
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
  'EXPIRED',
];
const TONE: Record<Status, StatusTone> = {
  PENDING_APPROVAL: 'pending',
  ON_HOLD: 'pending',
  LINK_SENT: 'processing',
  COMPLETED: 'approved',
  CANCELLED: 'inactive',
  REJECTED: 'rejected',
  EXPIRED: 'inactive',
};
const PAGE_SIZE = 20;
/** The checks a case needs: two, the call back among them (ADR 0052). */
const CALL_BACK = 'PHONE_CALLBACK';

/** A case's status in words, its hold's end in "On hold until". */
export function statusWords(recovery: Recovery, { tDynamic, locale }: Translator): string {
  return tDynamic(`rec.status.${recovery.status}`, {
    date: recovery.holdUntil === null ? '' : formatDate(recovery.holdUntil, locale),
  });
}

/** Who did something on a case (K1, K6): "You", the name with `user.read`, else "A staff member". */
function useWho() {
  const { t } = useConsole();
  const me = useMe();
  return (person: { id: string; name: string | null }) =>
    person.id === me.user.id ? t('history.you') : (person.name ?? t('history.staff'));
}

/** Recoveries (V1): a Status filter; cases are opened from an owner's page, so no *New*. */
export function Recoveries() {
  const translator = useConsole();
  const { t, tDynamic, locale } = translator;
  const who = useWho();
  const [status, setStatus] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const params: AdminRecoveriesListParams = {
    page,
    pageSize: PAGE_SIZE,
    ...(status === null ? {} : { status: status as AdminRecoveriesListParams['status'] }),
  };
  const list = useQuery({
    queryKey: ['recoveries', params],
    queryFn: () => adminRecoveriesList(params),
    placeholderData: keepPreviousData,
  });

  const owner = (row: Recovery) => (
    <Link href={`/recoveries/${row.id}`} className="flex flex-col hover:underline">
      <span className="font-medium text-foreground">{row.owner.name ?? t('rec.anOwner')}</span>
      <span className="text-xs text-muted-foreground">{row.owner.email}</span>
    </Link>
  );
  const badge = (row: Recovery) => (
    <StatusBadge tone={TONE[row.status]}>{statusWords(row, translator)}</StatusBadge>
  );
  const opened = (row: Recovery) => (
    <span className="flex flex-col whitespace-nowrap">
      <span>{formatDate(row.createdAt, locale)}</span>
      <span className="text-xs text-muted-foreground">
        {t('rec.by', { who: who(row.openedBy) })}
      </span>
    </span>
  );

  return (
    <>
      <PageHeader title={t('rec.title')} description={t('rec.lead')} />
      <div className="flex flex-wrap items-center gap-2">
        <Filter
          name={t('rec.status')}
          allLabel={t('rec.all')}
          value={status}
          options={STATUSES.map((value) => ({
            value,
            label:
              value === 'ON_HOLD' ? t('rec.statusFilter.ON_HOLD') : tDynamic(`rec.status.${value}`),
          }))}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
      </div>
      {list.isError ? (
        <ErrorView failure={failureOf(list.error)} onRetry={() => void list.refetch()} />
      ) : list.data !== undefined && list.data.data.length === 0 ? (
        <EmptyState icon={<LifeBuoy />} title={t('rec.emptyTitle')} body={t('rec.emptyBody')} />
      ) : (
        <>
          <DataList
            caption={t('rec.title')}
            columns={[
              { key: 'owner', label: t('rec.owner') },
              { key: 'address', label: t('rec.newAddress') },
              { key: 'status', label: t('rec.status') },
              { key: 'opened', label: t('rec.opened') },
            ]}
            rows={list.data?.data}
            rowKey={(row) => row.id}
            cell={(row, column) => {
              switch (column) {
                case 'owner':
                  return owner(row);
                case 'address':
                  return <EmailAddress email={row.requestedEmail} />;
                case 'status':
                  return badge(row);
                default:
                  return opened(row);
              }
            }}
            card={(row) => (
              <ListCard
                name={
                  <Link
                    href={`/recoveries/${row.id}`}
                    className="font-medium text-foreground hover:underline"
                  >
                    {row.owner.name ?? row.owner.email}
                  </Link>
                }
                status={badge(row)}
                facts={
                  <>
                    {t('recPage.newAddress')} <EmailAddress email={row.requestedEmail} />
                  </>
                }
                time={t('rec.cardOpened', {
                  date: formatDate(row.createdAt, locale),
                  who: who(row.openedBy),
                })}
              />
            )}
            rowEnd={{ label: t('rec.rowActions'), render: () => <RowChevron /> }}
          />
          {list.data === undefined ? null : (
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={list.data.meta.total}
              onPage={setPage}
              labels={{
                range: (range) => t('paging.range', range),
                previous: t('paging.previous'),
                next: t('paging.next'),
                page: (number) => t('paging.page', { page: number }),
              }}
            />
          )}
        </>
      )}
    </>
  );
}

/** One step of a case's timeline, ready to draw. */
interface Step {
  readonly key: string;
  readonly state: TimelineState;
  readonly title: ReactNode;
  readonly meta?: ReactNode;
  readonly note?: ReactNode;
}

/**
 * A case's steps (V3, V3b): opened, approved, on hold, link sent, completed — each done, current
 * or upcoming, the upcoming ones saying when; a stop (cancelled, rejected, expired) ends it.
 */
export function recoverySteps(
  recovery: Recovery,
  translator: Translator,
  who: (person: { id: string; name: string | null }) => string,
  /** Who rejected it, from the case's audit row (the case records only its approver). */
  rejectedBy?: { id: string; name: string | null },
): Step[] {
  const { t, tDynamic, locale } = translator;
  const checks = recovery.evidenceCodes.map((code) => tDynamic(`recPage.check.${code}`)).join(', ');
  const order: Status[] = ['PENDING_APPROVAL', 'ON_HOLD', 'LINK_SENT', 'COMPLETED'];
  const reached = order.indexOf(recovery.status);
  const at = (index: number): TimelineState =>
    recovery.status === 'COMPLETED' || index < reached
      ? 'done'
      : index === reached
        ? 'current'
        : 'upcoming';
  const steps: Step[] = [
    {
      key: 'opened',
      state: 'done',
      title: t('recPage.opened'),
      meta: `${who(recovery.openedBy)} · ${dateTime(recovery.createdAt, locale)}`,
      note: t('recPage.checks', { checks }),
    },
  ];
  // Who stopped it: the owner who cancelled; the rejecter, when the audit log was read.
  const stop = (key: string, title: string, note?: string, by?: string): Step[] => [
    ...steps,
    {
      key,
      state: 'stopped',
      title,
      meta: `${by === undefined ? '' : `${by} · `}${dateTime(recovery.updatedAt, locale)}`,
      ...(note === undefined ? {} : { note }),
    },
  ];
  if (recovery.approvedAt !== null && recovery.approvedBy !== null) {
    steps.push({
      key: 'approved',
      state: 'done',
      title: t('recPage.approved'),
      meta: `${who(recovery.approvedBy)} · ${dateTime(recovery.approvedAt, locale)}`,
    });
  }
  if (recovery.status === 'CANCELLED')
    return stop(
      'cancelled',
      t('recPage.cancelled'),
      t('recPage.cancelledNote'),
      recovery.owner.name ?? recovery.owner.email,
    );
  if (recovery.status === 'REJECTED')
    return stop(
      'rejected',
      t('recPage.rejected'),
      t('recPage.rejectedNote'),
      rejectedBy === undefined ? undefined : who(rejectedBy),
    );
  if (recovery.status === 'EXPIRED') return stop('expired', t('recPage.expired'));
  if (recovery.approvedAt === null)
    steps.push({
      key: 'approved',
      state: 'current',
      title: t('recPage.approvedNext'),
    });
  steps.push(
    recovery.holdUntil === null
      ? {
          key: 'hold',
          state: 'upcoming',
          title: t('recPage.holdNext'),
          meta: t('recPage.holdNextNote'),
        }
      : {
          key: 'hold',
          state: at(1),
          title: t('recPage.hold', { time: dateTime(recovery.holdUntil, locale) }),
          meta: t('recPage.holdNote'),
        },
    {
      key: 'link',
      state: at(2),
      title: t('recPage.linkSent'),
      meta:
        recovery.holdUntil === null
          ? t('recPage.linkNext')
          : t('recPage.linkWhen', { date: formatDate(recovery.holdUntil, locale) }),
    },
    {
      key: 'completed',
      state: at(3),
      title: t('recPage.completed'),
      meta:
        recovery.completedAt !== null
          ? dateTime(recovery.completedAt, locale)
          : t('recPage.orExpires', { date: formatDate(recovery.expiresAt, locale) }),
    },
  );
  return steps;
}

/**
 * A case's page (V3–V4c): the timeline from K6's fields and *The case*; *Reject…* and
 * *Approve…* for a holder of `user.email.recover.approve` who didn't open it (K23).
 */
export function RecoveryPage({ initial }: { initial: Recovery }) {
  const translator = useConsole();
  const { t, tDynamic, locale } = translator;
  const can = useCan();
  const me = useMe();
  const who = useWho();
  const queries = useQueryClient();
  const recovery = useQuery({
    queryKey: ['recovery', initial.id],
    queryFn: async () => (await adminRecoveriesGet(initial.id)).data.recovery,
    initialData: initial,
  }).data;
  // The Rejected stop's "who", from the case's newest rejection row, as U5b's *Locked by*.
  const rejection = useQuery({
    queryKey: ['history', 'ACCOUNT_RECOVERY', recovery.id, 'rejected'],
    queryFn: async () => {
      const rows = await auditLogsList({
        resourceType: 'ACCOUNT_RECOVERY',
        resourceId: recovery.id,
        action: 'ACCOUNT_RECOVERY_REJECTED',
        from: recovery.createdAt,
        to: new Date().toISOString(),
        limit: 1,
      });
      return rows.data[0] ?? null;
    },
    enabled: recovery.status === 'REJECTED' && can('audit.read'),
    // The audit row is written after the rejection: read again until it is there, ten tries at most.
    refetchInterval: (query) =>
      query.state.data === null && query.state.dataUpdateCount < 10 ? 2_000 : false,
  });
  const rejecter = rejection.data?.actor;
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null);
  const [busy, setBusy] = useState(false);
  const name = recovery.owner.name ?? recovery.owner.email;
  const decidable = recovery.status === 'PENDING_APPROVAL' && can('user.email.recover.approve');
  const ownCase = recovery.openedById === me.user.id;

  const refresh = () => {
    void queries.invalidateQueries({ queryKey: ['recovery', recovery.id] });
    void queries.invalidateQueries({ queryKey: ['recoveries'] });
  };
  const decided = (error: unknown) => {
    setBusy(false);
    setDialog(null);
    const status = (error instanceof ApiError &&
      (error.details as { status?: string } | undefined)?.status) as Status | undefined;
    toast.error(
      error instanceof ApiError && error.code === 'INVALID_STATE' && status !== undefined
        ? t('recDecide.already', {
            status: tDynamic(`rec.status.${status}`, { date: '' }).toLowerCase(),
          })
        : errorText(error, translator),
      { duration: Infinity },
    );
    refresh();
  };
  const approve = () => {
    setBusy(true);
    adminRecoveriesApprove(recovery.id).then(({ data }) => {
      setBusy(false);
      setDialog(null);
      toast.success(t('recApprove.done'), {
        description:
          data.recovery.holdUntil === null
            ? undefined
            : t('recApprove.doneBody', { time: dateTime(data.recovery.holdUntil, locale) }),
      });
      refresh();
    }, decided);
  };
  const reject = (decisionNote: string) => {
    setBusy(true);
    adminRecoveriesReject(recovery.id, { decisionNote }).then(() => {
      setBusy(false);
      setDialog(null);
      toast.success(t('recReject.done'));
      refresh();
    }, decided);
  };

  const steps = recoverySteps(
    recovery,
    translator,
    who,
    rejecter?.userId === undefined || rejecter.userId === null
      ? undefined
      : { id: rejecter.userId, name: rejecter.name },
  );
  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/recoveries" className="text-sm text-muted-foreground hover:underline">
            {t('rec.title')}
          </Link>
        }
        title={t('recPage.title', { name })}
        badges={
          <StatusBadge tone={TONE[recovery.status]}>
            {statusWords(recovery, translator)}
          </StatusBadge>
        }
        description={t('recPage.line', {
          time: dateTime(recovery.createdAt, locale),
          who: who(recovery.openedBy),
          ref: recovery.supportReference,
        })}
        action={
          decidable && !ownCase ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setDialog('reject')}>
                {t('recPage.reject')}
              </Button>
              <Button onClick={() => setDialog('approve')}>{t('recPage.approve')}</Button>
            </div>
          ) : undefined
        }
      />
      {decidable && ownCase ? (
        <div
          role="note"
          className="flex items-start gap-3 rounded-md bg-info px-4 py-3 text-sm text-info-foreground"
        >
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong className="block">{t('recPage.ownCaseTitle')}</strong>
            {t('recPage.ownCaseBody')}
          </span>
        </div>
      ) : null}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <Card className="flex flex-col gap-4 lg:col-span-2" aria-labelledby="recovery-timeline">
          <h2 id="recovery-timeline" className="text-lg font-semibold text-foreground">
            {t('recPage.timeline')}
          </h2>
          <Timeline label={t('recPage.timeline')}>
            {steps.map((step, index) => (
              <TimelineItem
                key={step.key}
                state={step.state}
                stateLabel={tDynamic(`recPage.state.${step.state}`)}
                title={step.title}
                meta={step.meta}
                note={step.note}
                last={index === steps.length - 1}
              />
            ))}
          </Timeline>
        </Card>
        <Card className="flex flex-col gap-3" aria-labelledby="recovery-case">
          <h2 id="recovery-case" className="text-lg font-semibold text-foreground">
            {t('recPage.case')}
          </h2>
          <Facts
            fit
            rows={[
              [
                t('recPage.currentAddress'),
                <Link
                  key="owner"
                  href={`/users/${recovery.userId}`}
                  className="text-primary hover:underline"
                >
                  <EmailAddress email={recovery.owner.email} />
                </Link>,
              ],
              [t('recPage.newAddress'), <EmailAddress key="new" email={recovery.requestedEmail} />],
              [
                t('recPage.checksLabel'),
                recovery.evidenceCodes.map((code) => tDynamic(`recPage.check.${code}`)).join(', '),
              ],
              [t('recPage.support'), recovery.supportReference],
              [t('recPage.expires'), formatDate(recovery.expiresAt, locale)],
            ]}
          />
        </Card>
      </div>
      <ConfirmDialog
        open={dialog === 'approve'}
        onOpenChange={(open) => setDialog(open ? 'approve' : null)}
        title={t('recApprove.title', { name })}
        description={t('recApprove.body', {
          name,
          email: recovery.requestedEmail,
          date: formatDate(recovery.expiresAt, locale),
        })}
        confirm={t('recApprove.confirm')}
        busy={busy ? t('recApprove.confirm') : undefined}
        labels={{ cancel: t('action.cancel'), close: t('action.close') }}
        onConfirm={approve}
      />
      <ReasonDialog
        open={dialog === 'reject'}
        onOpenChange={(open) => setDialog(open ? 'reject' : null)}
        title={t('recReject.title', { name })}
        description={t('recReject.body')}
        confirm={t('recReject.confirm')}
        busy={busy ? t('recReject.confirm') : undefined}
        labels={{ cancel: t('action.cancel'), close: t('action.close') }}
        noteLabel={t('recReject.why')}
        noteHelp={t('recReject.whyHelp', { max: MAX_RECOVERY_DECISION_NOTE_LENGTH })}
        placeholder={t('recReject.whyPlaceholder')}
        minLength={1}
        maxLength={MAX_RECOVERY_DECISION_NOTE_LENGTH}
        onConfirm={reject}
      />
    </>
  );
}

/** A live case of the owner's, for V2c's *Open that case*. */
async function liveCase(userId: string): Promise<Recovery | undefined> {
  for (const status of ['PENDING_APPROVAL', 'ON_HOLD', 'LINK_SENT'] as const) {
    const { data } = await adminRecoveriesList({ status, pageSize: 100 });
    const found = data.find((row) => row.userId === userId);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Open a case (V2–V2c), from an owner's page: the new address, the checks as boxes (the call back
 * required), the support reference. Nothing is sent until someone else approves.
 */
export function OpenRecoveryDialog({
  user,
  onOpenChange,
}: {
  user: Subject;
  onOpenChange: (open: boolean) => void;
}) {
  const translator = useConsole();
  const { t, tDynamic, locale } = translator;
  const who = useWho();
  const queries = useQueryClient();
  const [email, setEmail] = useState('');
  const [checks, setChecks] = useState<ReadonlySet<string>>(new Set());
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<ReactNode>(null);
  const [busy, setBusy] = useState(false);

  const open = () => {
    const found: Record<string, string> = {};
    if (email.trim() === '') found.email = t('recOpen.required');
    if (checks.size < 2 || !checks.has(CALL_BACK)) found.checks = t('recOpen.tooFew');
    if (reference.trim() === '') found.reference = t('recOpen.referenceRequired');
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setAlert(null);
    adminRecoveriesOpenRecovery(user.id, {
      requestedEmail: email.trim(),
      evidenceCodes: [...checks] as Parameters<
        typeof adminRecoveriesOpenRecovery
      >[1]['evidenceCodes'],
      supportReference: reference.trim(),
    }).then(
      () => {
        setBusy(false);
        void queries.invalidateQueries({ queryKey: ['recoveries'] });
        toast.success(t('recOpen.done'), { description: t('recOpen.doneBody') });
        onOpenChange(false);
      },
      async (error: unknown) => {
        setBusy(false);
        const code = error instanceof ApiError ? error.code : null;
        const status = (error instanceof ApiError &&
          (error.details as { status?: string } | undefined)?.status) as string | undefined;
        if (code === 'RECOVERY_EVIDENCE_INSUFFICIENT') setErrors({ checks: t('recOpen.tooFew') });
        else if (code === 'EMAIL_TAKEN') setErrors({ email: t('recOpen.taken') });
        else if (code === 'INVALID_STATE' && status === 'NOT_AN_OWNER')
          setAlert(t('recOpen.notOwner', { name: user.name }));
        else if (code === 'INVALID_STATE') {
          const live = await liveCase(user.id).catch(() => undefined);
          setAlert(
            <>
              <strong className="block">{t('recOpen.liveTitle', { name: user.name })}</strong>
              <span className="block">
                {live === undefined
                  ? t('recOpen.liveBodyPlain')
                  : t('recOpen.liveBody', {
                      date: formatDate(live.createdAt, locale),
                      who: who(live.openedBy),
                      // Only the first letter: the date keeps its own case ("31 Oct 2026").
                      status: statusWords(live, translator).replace(/^\p{Lu}/u, (letter) =>
                        letter.toLowerCase(),
                      ),
                    })}
              </span>
              {live === undefined ? null : (
                <Link href={`/recoveries/${live.id}`} className="font-medium underline">
                  {t('recOpen.openThat')}
                </Link>
              )}
            </>,
          );
        } else setAlert(errorText(error, translator));
      },
    );
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('action.close')}>
        <DialogHeader title={t('recOpen.title', { name: user.name })} />
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            open();
          }}
        >
          {alert === null ? null : <FormAlert>{alert}</FormAlert>}
          <Field
            label={t('recOpen.address')}
            required
            help={t('recOpen.addressHelp')}
            error={errors.email}
          >
            {(control) => (
              <Input
                {...control}
                type="email"
                autoComplete="off"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </Field>
          <fieldset
            className="flex flex-col gap-2"
            aria-describedby="recovery-checks-help"
            aria-invalid={errors.checks === undefined ? undefined : true}
          >
            <legend className="mb-1 text-sm font-medium text-foreground">
              {t('recOpen.checks')}
              <span aria-hidden className="ml-1 text-destructive">
                *
              </span>
            </legend>
            {RECOVERY_EVIDENCE_CODES.map((code) => (
              <label key={code} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={checks.has(code)}
                  onChange={(event) =>
                    setChecks((now) => {
                      const next = new Set(now);
                      if (event.target.checked) next.add(code);
                      else next.delete(code);
                      return next;
                    })
                  }
                />
                {tDynamic(`recOpen.check.${code}`)}
              </label>
            ))}
            <p id="recovery-checks-help" className="text-xs text-muted-foreground">
              {t('recOpen.checksHelp')}
            </p>
            {errors.checks === undefined ? null : <FieldError>{errors.checks}</FieldError>}
          </fieldset>
          <Field
            label={t('recOpen.reference')}
            required
            help={t('recOpen.referenceHelp')}
            error={errors.reference}
          >
            {(control) => (
              <Input
                {...control}
                autoComplete="off"
                maxLength={MAX_SUPPORT_REFERENCE_LENGTH}
                value={reference}
                onChange={(event) => setReference(event.target.value)}
              />
            )}
          </Field>
          <p className="flex items-start gap-2 rounded-md bg-info px-3 py-2 text-sm text-info-foreground">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t('recOpen.nothingSent', { name: user.name })}
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('action.cancel')}
            </Button>
            <Button type="submit" busy={busy ? t('recOpen.confirm') : undefined}>
              {t('recOpen.confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
