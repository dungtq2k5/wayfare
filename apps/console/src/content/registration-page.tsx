'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  adminOwnerRegistrationsApprove,
  adminOwnerRegistrationsGet,
  adminOwnerRegistrationsReject,
  adminOwnerRegistrationsReveal,
} from '@wayfare/api-client';
import { MAX_REVEAL_REASON_LENGTH, MIN_REVEAL_REASON_LENGTH } from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { ReasonDialog } from '@wayfare/ui/dialogs';
import { PageHeader } from '@wayfare/ui/list';
import { Card, StatusBadge } from '@wayfare/ui/surfaces';
import type { StatusTone } from '@wayfare/ui/surfaces';
import { toast } from '@wayfare/ui/toaster';
import { CircleCheck, Eye, EyeOff, Info } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { errorText, retryMinutes } from '../client/errors';
import { EmailAddress } from '../components/email-address';
import { useConsole } from '../i18n/provider';
import { relativeTime } from '../notifications/text';
import { useCan } from '../shell/can';
import { useMe } from '../shell/me';
import { DecisionDialog } from './decision-dialog';
import type { DecisionNotes } from './decision-dialog';
import { Facts } from './place-sections';
import { formatDate, formatPhone } from '../i18n/format';

type Detail = Awaited<ReturnType<typeof adminOwnerRegistrationsGet>>['data'];

export const REGISTRATION_TONES: Record<Detail['status'], StatusTone> = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  WITHDRAWN: 'inactive',
};

function Panel({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-3" aria-labelledby={id}>
      <h2 id={id} className="text-lg font-semibold text-foreground">
        {title}
      </h2>
      {children}
    </Card>
  );
}

/**
 * An application (R2–R4b). The national ID shows as its last four; *Reveal…* — only for a holder
 * of `owner_registration.pii.read` — asks why (K12), and the number then lives in this component's
 * state alone: never a query's cache, the URL or a field, gone on *Hide* or on leaving. A redacted
 * application (R3c) has nothing to reveal. One's own application is read-only (R4b).
 */
export function RegistrationPage({ initial }: { initial: Detail }) {
  const translator = useConsole();
  const { t, tDynamic, locale } = translator;
  const can = useCan();
  const me = useMe();
  const router = useRouter();
  const queries = useQueryClient();
  const detail = useQuery({
    queryKey: ['registration', initial.id],
    queryFn: async () => (await adminOwnerRegistrationsGet(initial.id)).data,
    initialData: initial,
  });
  const data = detail.data;
  const [number, setNumber] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealBusy, setRevealBusy] = useState(false);
  const [revealAlert, setRevealAlert] = useState<string | null>(null);
  const [redacted, setRedacted] = useState(data.piiRedacted);
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [own, setOwn] = useState(data.applicant.id === me.user.id);
  const [decided, setDecided] = useState(false);
  const now = new Date();
  const date = (iso: string) => formatDate(iso, locale);
  const applicant = data.applicant.fullName ?? data.contactName;
  const pending = data.status === 'PENDING';

  const reveal = async (reason: string) => {
    if (revealBusy) return;
    setRevealBusy(true);
    setRevealAlert(null);
    try {
      const { data: revealed } = await adminOwnerRegistrationsReveal(data.id, { reason });
      setNumber(revealed.nationalId);
      setRevealing(false);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'NATIONAL_ID_REDACTED') {
        setRedacted(true);
        setRevealing(false);
      } else if (error instanceof ApiError && error.code === 'RATE_LIMITED') {
        setRevealAlert(t('reveal.rateLimited', { minutes: retryMinutes(error) }));
      } else {
        setRevealAlert(errorText(error, translator));
      }
    } finally {
      setRevealBusy(false);
    }
  };

  const decide = async (which: 'approve' | 'reject', notes: DecisionNotes) => {
    if (busy) return;
    setBusy(true);
    setAlert(null);
    try {
      if (which === 'approve') await adminOwnerRegistrationsApprove(data.id, notes);
      else
        await adminOwnerRegistrationsReject(data.id, {
          decisionNote: notes.decisionNote ?? '',
          ...notes,
        });
      void queries.invalidateQueries({ queryKey: ['registrations'] });
      void queries.invalidateQueries({ queryKey: ['nav-counts'] });
      toast.success(which === 'approve' ? t('approve.done') : t('reject.done'));
      router.push('/registrations');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_STATE') {
        setDialog(null);
        setDecided(true);
        void detail.refetch();
      } else if (error instanceof ApiError && error.code === 'PERMISSION_DENIED') {
        setDialog(null);
        setOwn(true);
      } else {
        setAlert(errorText(error, translator));
      }
    } finally {
      setBusy(false);
    }
  };

  const nationalId = redacted ? (
    <span className="flex flex-col gap-1">
      <span className="text-foreground">
        {data.piiRedactedAt === null
          ? t('reveal.redacted')
          : t('reveal.redactedOn', { date: date(data.piiRedactedAt) })}
      </span>
      <span className="text-xs text-muted-foreground">{t('reveal.redactedBody')}</span>
    </span>
  ) : number !== null ? (
    <span className="flex flex-col gap-2">
      <span className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-2 rounded-md bg-warning px-3 py-1 font-medium text-warning-foreground">
          <Eye aria-hidden className="size-4" />
          {/* Read in groups of three, as it is printed on the card. */}
          {number.replace(/(\d{3})(?=\d)/g, '$1 ')}
        </span>
        <Button variant="outline" size="sm" onClick={() => setNumber(null)}>
          <EyeOff aria-hidden />
          {t('reveal.hide')}
        </Button>
      </span>
      <span className="text-xs text-muted-foreground">{t('reveal.shownOnce')}</span>
    </span>
  ) : (
    <span className="flex flex-col gap-2">
      <span className="flex flex-wrap items-center gap-2">
        <span>•••• {data.nationalIdLast4 ?? '····'}</span>
        {can('owner_registration.pii.read') ? (
          <Button variant="outline" size="sm" onClick={() => setRevealing(true)}>
            <Eye aria-hidden />
            {t('registration.reveal')}
          </Button>
        ) : null}
      </span>
      {can('owner_registration.pii.read') ? (
        <span className="text-xs text-muted-foreground">{t('registration.revealNote')}</span>
      ) : null}
    </span>
  );

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/registrations" className="text-sm text-muted-foreground hover:underline">
            {t('registrations.title')}
          </Link>
        }
        title={data.businessName}
        badges={
          <StatusBadge tone={REGISTRATION_TONES[data.status]}>
            {pending ? t('status.pending') : tDynamic(`regStatus.${data.status}`)}
          </StatusBadge>
        }
        description={
          pending || data.reviewedAt === null
            ? t('registration.submittedBy', {
                when: relativeTime(data.submittedAt, now, translator),
                email: data.applicant.email,
              })
            : t('registration.submittedDecided', {
                submitted: date(data.submittedAt),
                decided: date(data.reviewedAt),
              })
        }
      />

      {own ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-md bg-info px-4 py-3 text-sm text-info-foreground"
        >
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong className="block">{t('ownApp.title')}</strong>
            {t('ownApp.body')}
          </span>
        </p>
      ) : null}
      {decided ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-info px-4 py-3 text-sm text-info-foreground"
        >
          <span>
            <strong className="block">{t('decided.title')}</strong>
            {t('decided.body')}
          </span>
          <Button asChild variant="outline">
            <Link href="/registrations">{t('decided.back')}</Link>
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Panel id="business" title={t('registration.business')}>
            <Facts
              rows={[
                [t('field.name'), <span lang="vi">{data.businessName}</span>],
                [t('registration.address'), <span lang="vi">{data.businessAddress}</span>],
                [t('registration.regNumber'), data.businessRegistrationNo ?? t('place.none')],
              ]}
            />
          </Panel>
          <Panel id="contact" title={t('registration.contact')}>
            <Facts
              rows={[
                [t('field.name'), <span lang="vi">{data.contactName}</span>],
                [
                  t('registration.phone'),
                  redacted ? t('registration.redacted') : formatPhone(data.contactPhone),
                ],
                [t('registration.nationalId'), nationalId],
              ]}
            />
          </Panel>
          {redacted ? (
            <Panel id="their-note" title={t('registration.theirNote')}>
              <p className="text-sm text-muted-foreground">{t('registration.redacted')}</p>
            </Panel>
          ) : data.applicantNote === null ? null : (
            <Panel id="their-note" title={t('registration.theirNote')}>
              <p lang="vi" className="text-sm text-foreground">
                {data.applicantNote}
              </p>
            </Panel>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Panel id="applicant" title={t('registration.applicant')}>
            <Facts
              fit
              rows={[
                [
                  t('field.email'),
                  <span key="email" className="flex flex-wrap items-center gap-2">
                    <EmailAddress email={data.applicant.email} />
                    {data.applicant.emailVerified ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-success px-2 py-0.5 text-xs font-medium text-success-foreground">
                        <CircleCheck aria-hidden className="size-3" />
                        {t('registration.emailVerified')}
                      </span>
                    ) : null}
                  </span>,
                ],
                [t('registration.accountSince'), date(data.applicant.createdAt)],
                [
                  t('registration.owner'),
                  data.applicant.ownerVerified ? t('submission.yes') : t('registration.notYet'),
                ],
              ]}
            />
          </Panel>
          <Panel id="earlier" title={t('registration.earlier')}>
            {data.priorApplications.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('registration.none')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.priorApplications.map((prior) => (
                  <li key={prior.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <StatusBadge tone={REGISTRATION_TONES[prior.status]}>
                      {tDynamic(`regStatus.${prior.status}`)}
                    </StatusBadge>
                    <span className="text-muted-foreground">
                      {date(prior.reviewedAt ?? prior.submittedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {pending && !own && !decided && can('owner_registration.review') ? (
            <Panel id="decision" title={t('submission.decision')}>
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
                  onClick={() => {
                    setAlert(null);
                    setDialog('approve');
                  }}
                >
                  {t('submission.approve')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('registration.emailed', { name: applicant })}
              </p>
            </Panel>
          ) : !pending ? (
            // The outcome and its date, as *Earlier applications* shows one, then the note.
            <Panel id="decision" title={t('submission.decision')}>
              <span className="flex flex-wrap items-center gap-2 text-sm">
                <StatusBadge tone={REGISTRATION_TONES[data.status]}>
                  {tDynamic(`regStatus.${data.status}`)}
                </StatusBadge>
                {data.reviewedAt === null ? null : (
                  <span className="text-muted-foreground">{date(data.reviewedAt)}</span>
                )}
              </span>
              {data.decisionNote === null ? null : (
                <p className="text-sm text-foreground">“{data.decisionNote}”</p>
              )}
            </Panel>
          ) : null}
        </div>
      </div>

      <ReasonDialog
        open={revealing}
        onOpenChange={(open) => {
          if (!open) setRevealAlert(null);
          setRevealing(open);
        }}
        title={t('reveal.title')}
        description={t('reveal.body')}
        confirm={t('reveal.confirm')}
        busy={revealBusy ? t('action.saving') : undefined}
        labels={{ cancel: t('action.cancel'), close: t('action.close') }}
        alert={revealAlert}
        noteLabel={t('reveal.why')}
        placeholder={t('reveal.whyPlaceholder')}
        noteHelp={t('reveal.whyHelp')}
        tone="primary"
        minLength={MIN_REVEAL_REASON_LENGTH}
        maxLength={MAX_REVEAL_REASON_LENGTH}
        onConfirm={(reason) => void reveal(reason)}
      />
      <DecisionDialog
        open={dialog === 'approve'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t('regApprove.title', { name: data.businessName })}
        confirm={t('approve.confirm')}
        note={{
          label: t('regApprove.note'),
          help: t('regApprove.noteHelp'),
          placeholder: t('decision.applicantNotePlaceholder'),
        }}
        busy={busy}
        alert={alert}
        onConfirm={(notes) => void decide('approve', notes)}
      >
        <p>{t('regApprove.body', { applicant })}</p>
        <p>{t('regApprove.told')}</p>
      </DecisionDialog>
      <DecisionDialog
        open={dialog === 'reject'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t('regReject.title', { name: data.businessName })}
        confirm={t('reject.confirm')}
        reject
        note={{
          label: t('regReject.note'),
          help: t('regReject.noteHelp'),
          placeholder: t('decision.applicantNotePlaceholder'),
        }}
        busy={busy}
        alert={alert}
        onConfirm={(notes) => void decide('reject', notes)}
      >
        <p>{t('regReject.body', { applicant })}</p>
      </DecisionDialog>
    </>
  );
}
