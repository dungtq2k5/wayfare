'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ownerSubmissionsGet, ownerSubmissionsWithdraw } from '@wayfare/api-client';
import type { SubmissionEditableField } from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { ConfirmDialog } from '@wayfare/ui/dialogs';
import { PageHeader } from '@wayfare/ui/list';
import { Card, StatusBadge } from '@wayfare/ui/surfaces';
import { toast } from '@wayfare/ui/toaster';
import Link from 'next/link';
import { useState } from 'react';
import { errorText } from '../client/errors';
import { FieldCard, ProposalDetails } from '../content/submission-diff';
import { formatDate, formatTime } from '../i18n/format';
import { useConsole } from '../i18n/provider';
import { OWNER_KEYS, useOwnerPlaces } from './queries';
import { Notice } from './registration';
import { SUBMISSION_TONES } from './submissions';

type Submission = Awaited<ReturnType<typeof ownerSubmissionsGet>>['data'];

/** The fields a new venue's proposal shows in cards of their own, after its Details. */
const LIST_FIELDS = ['location', 'openingHours', 'menu', 'photos'] as const;

/**
 * A submission (Q2, Q2b; K6): only what changes, *Before* and *Proposed*, from the server's diff;
 * waiting, it can be withdrawn (asked, no Undo — send it again); not approved, the admin's note
 * and *Propose again*, which opens the form with this content.
 */
export function OwnerSubmissionPage({ initial }: { initial: Submission }) {
  const translator = useConsole();
  const { t, locale } = translator;
  const queries = useQueryClient();
  const places = useOwnerPlaces();
  const detail = useQuery({
    queryKey: ['owner-submission', initial.id],
    queryFn: async () => (await ownerSubmissionsGet(initial.id)).data,
    initialData: initial,
  });
  const data = detail.data;
  const [withdrawing, setWithdrawing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const venue =
    (data.placeId === null
      ? undefined
      : places.data?.find((place) => place.id === data.placeId)?.nameVi) ?? data.payload.nameVi;
  const create = data.kind === 'CREATE';
  const sent = t('mySub.sentAt', {
    date: formatDate(data.submittedAt, locale),
    time: formatTime(data.submittedAt, locale),
  });

  const withdraw = async () => {
    if (busy) return;
    setBusy(true);
    setAlert(null);
    try {
      await ownerSubmissionsWithdraw(data.id);
      setWithdrawing(false);
      toast.success(t('mySub.withdrawn'));
      void queries.invalidateQueries({ queryKey: ['owner-submissions'] });
      void queries.invalidateQueries({ queryKey: OWNER_KEYS.limits });
      await detail.refetch();
    } catch (error) {
      setAlert(errorText(error, translator));
    } finally {
      setBusy(false);
    }
  };

  const again = create
    ? `/owner/venues/new?from=${data.id}`
    : `/owner/venues/${data.placeId ?? ''}/edit?from=${data.id}`;
  const payload = data.payload as unknown as Partial<Record<SubmissionEditableField, unknown>>;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/owner/submissions" className="text-sm text-muted-foreground hover:underline">
            {t('mySubs.title')}
          </Link>
        }
        title={create ? `${t('mySub.newVenue')} · ${venue}` : t('mySub.changeTo', { venue })}
        badges={
          <StatusBadge tone={SUBMISSION_TONES[data.status]}>
            {t(`mySubs.status.${data.status}`)}
          </StatusBadge>
        }
        description={
          data.reviewedAt === null
            ? sent
            : `${sent} · ${t('mySub.decidedOn', { date: formatDate(data.reviewedAt, locale) })}`
        }
        // The page's own action stays in its header, as a venue's *Close for now*.
        action={
          data.status === 'PENDING' ? (
            <Button variant="outline" onClick={() => setWithdrawing(true)}>
              {t('mySub.withdraw')}
            </Button>
          ) : data.status === 'REJECTED' ? (
            <Button asChild>
              <Link href={again}>{t('mySub.proposeAgain')}</Link>
            </Button>
          ) : undefined
        }
      />
      {data.status === 'PENDING' ? (
        <Notice tone="info" title={t('mySub.waitingTitle')}>
          {t('mySub.waitingBody', { venue })}
        </Notice>
      ) : data.status === 'REJECTED' ? (
        <Notice tone="warning" title={t('mySub.noteFrom')}>
          {data.decisionNote === null ? null : t('myReg.quoted', { note: data.decisionNote })}
        </Notice>
      ) : null}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <Card aria-labelledby="proposed-heading" className="flex flex-col gap-4 lg:col-span-2">
          <div className="flex flex-col gap-1">
            <h2 id="proposed-heading" className="text-lg font-semibold text-foreground">
              {t('mySub.proposed')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('mySub.proposedLead')}</p>
          </div>
          {create ? (
            <>
              <ProposalDetails payload={payload} />
              {LIST_FIELDS.map((field) => (
                <FieldCard
                  key={field}
                  field={field}
                  columns={[{ label: t('mySub.after'), value: payload[field] }]}
                  conflict={false}
                  photoSource={() => undefined}
                  mapStyle={null}
                />
              ))}
            </>
          ) : (
            (data.diff ?? []).map((entry) => (
              <FieldCard
                key={entry.field}
                field={entry.field}
                columns={[
                  { label: t('mySub.before'), value: entry.before },
                  { label: t('mySub.after'), value: entry.after },
                ]}
                conflict={false}
                photoSource={() => undefined}
                mapStyle={null}
                changesOnly
              />
            ))
          )}
        </Card>
        {data.placeId === null ? null : (
          <Card className="flex flex-col gap-3" aria-labelledby="venue-heading">
            <h2 id="venue-heading" className="text-lg font-semibold text-foreground">
              {t('mySub.theVenue')}
            </h2>
            <p className="text-sm text-foreground">{venue}</p>
            <Button asChild variant="outline" size="sm" className="self-start">
              <Link href={`/owner/venues/${data.placeId}`}>{t('mySub.openVenue')}</Link>
            </Button>
          </Card>
        )}
      </div>
      <ConfirmDialog
        open={withdrawing}
        onOpenChange={(open) => {
          setWithdrawing(open);
          if (!open) setAlert(null);
        }}
        title={t('mySub.withdrawTitle')}
        description={t('mySub.withdrawBody')}
        confirm={t('mySub.withdrawConfirm')}
        busy={busy ? t('action.saving') : undefined}
        alert={alert ?? undefined}
        labels={{ cancel: t('action.cancel'), close: t('action.close') }}
        onConfirm={() => void withdraw()}
      />
    </>
  );
}
