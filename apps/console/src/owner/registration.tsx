'use client';

import { useQuery } from '@tanstack/react-query';
import { ownerRegistrationList, ownerRegistrationWithdraw } from '@wayfare/api-client';
import { maskEmail } from '@wayfare/contracts';
import { OwnerRegistrationStatus } from '@wayfare/contracts';
import type { OwnerRegistration } from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { ConfirmDialog } from '@wayfare/ui/dialogs';
import { PageHeader } from '@wayfare/ui/list';
import { Card, StatusBadge } from '@wayfare/ui/surfaces';
import { Timeline, TimelineItem } from '@wayfare/ui/timeline';
import { toast } from '@wayfare/ui/toaster';
import { CircleAlert, Info, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { errorText } from '../client/errors';
import { Facts } from '../content/place-sections';
import { REGISTRATION_TONES } from '../content/registration-page';
import { formatDate, formatPhone, formatTime } from '../i18n/format';
import { useConsole } from '../i18n/provider';
import { useMe } from '../shell/me';
import { ResendLink } from './check-email';

/** The registration read, newest first (K2). */
export const REGISTRATIONS_KEY = ['owner-registrations'] as const;

export function useRegistrations(initial?: OwnerRegistration[]) {
  return useQuery({
    queryKey: REGISTRATIONS_KEY,
    queryFn: async () => (await ownerRegistrationList()).data as OwnerRegistration[],
    ...(initial === undefined ? {} : { initialData: initial }),
  });
}

/** A box of the page's tone: the info, warning and error boxes of round 33. */
export function Notice({
  tone,
  title,
  children,
  action,
}: {
  tone: 'info' | 'warning' | 'error';
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const Icon = tone === 'info' ? Info : tone === 'warning' ? TriangleAlert : CircleAlert;
  const colours =
    tone === 'info'
      ? 'bg-info text-info-foreground'
      : tone === 'warning'
        ? 'bg-warning text-warning-foreground'
        : 'border border-destructive bg-card text-destructive';
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className={`flex items-start gap-3 rounded-md px-4 py-3 text-sm ${colours}`}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title === undefined ? null : <p className="font-medium">{title}</p>}
        {children === undefined ? null : <div>{children}</div>}
        {action === undefined ? null : <div className="pt-1">{action}</div>}
      </div>
    </div>
  );
}

function ApplyLink({ children }: { children: ReactNode }) {
  return (
    <Button asChild className="self-start">
      <Link href="/owner/registration/apply">{children}</Link>
    </Button>
  );
}

/** *What you sent* (N5): the answers, the national ID as its last four only. */
function WhatYouSent({ registration }: { registration: OwnerRegistration }) {
  const { t } = useConsole();
  return (
    <Card className="flex flex-col gap-3" aria-labelledby="sent-heading">
      <h2 id="sent-heading" className="text-lg font-semibold text-foreground">
        {t('myReg.whatYouSent')}
      </h2>
      <Facts
        fit
        rows={[
          [t('myReg.business'), registration.businessName],
          [t('myReg.address'), registration.businessAddress],
          ...(registration.businessRegistrationNo === null
            ? []
            : [[t('myReg.regNo'), registration.businessRegistrationNo] as const]),
          [
            t('myReg.contact'),
            `${registration.contactName} · ${formatPhone(registration.contactPhone)}`,
          ],
          ...(registration.nationalIdLast4 === null
            ? []
            : [
                [
                  t('myReg.nationalId'),
                  <span key="id" className="font-mono">
                    {t('myReg.last4', { last4: registration.nationalIdLast4 })}
                  </span>,
                ] as const,
              ]),
          ...(registration.applicantNote === null
            ? []
            : [[t('myReg.note'), registration.applicantNote] as const]),
        ]}
      />
      <p className="text-xs text-muted-foreground">{t('myReg.idNote')}</p>
    </Card>
  );
}

/**
 * *Your registration* (N2b, N5–N7; K1–K3): an unverified account is told to verify first, with no
 * form; else the newest application — waiting with its timeline and *Withdraw…*, not approved with
 * the admin's note, or withdrawn — and the earlier ones under it.
 */
export function RegistrationView({
  initial,
  title,
}: {
  initial?: OwnerRegistration[];
  title?: string;
}) {
  const translator = useConsole();
  const { t, locale } = translator;
  const me = useMe();
  const registrations = useRegistrations(initial);
  const [withdrawing, setWithdrawing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const date = (iso: string) => formatDate(iso, locale);
  const at = (iso: string) =>
    t('myReg.decidedAt', { date: date(iso), time: formatTime(iso, locale) });
  const header = <PageHeader title={title ?? t('myReg.title')} description={t('myReg.lead')} />;

  if (!me.user.isEmailVerified) {
    return (
      <>
        {header}
        {/* A blocked step is a warning (N2b), its remedy under it. */}
        <div className="flex max-w-2xl flex-col gap-3">
          <Notice tone="warning" title={t('checkEmail.verifyTitle')}>
            {t('checkEmail.verifyBody', { email: maskEmail(me.user.email) })}
          </Notice>
          <ResendLink />
        </div>
      </>
    );
  }

  const list = registrations.data ?? [];
  const latest = list[0];
  if (latest === undefined) {
    return (
      <>
        {header}
        {registrations.isPending ? null : (
          <Card className="flex flex-col gap-4">
            <p className="text-sm text-foreground">{t('myReg.notYet')}</p>
            <ApplyLink>{t('myReg.start')}</ApplyLink>
          </Card>
        )}
      </>
    );
  }

  const withdraw = async () => {
    if (busy) return;
    setBusy(true);
    setAlert(null);
    try {
      await ownerRegistrationWithdraw(latest.id);
      setWithdrawing(false);
      toast.success(t('myReg.withdrawn'));
      await registrations.refetch();
    } catch (error) {
      setAlert(errorText(error, translator));
    } finally {
      setBusy(false);
    }
  };

  const earlier = list.slice(1);
  const status = (
    <StatusBadge tone={REGISTRATION_TONES[latest.status]}>
      {t(`myReg.status.${latest.status}`)}
    </StatusBadge>
  );

  return (
    <>
      {header}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card className="flex flex-col gap-4" aria-labelledby="application-heading">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="application-heading" className="text-lg font-semibold text-foreground">
                {latest.businessName}
              </h2>
              {status}
            </div>
            {latest.status === OwnerRegistrationStatus.REJECTED ? (
              <Notice tone="warning" title={t('myReg.noteFrom')}>
                {latest.decisionNote === null
                  ? null
                  : t('myReg.quoted', { note: latest.decisionNote })}
              </Notice>
            ) : latest.status === OwnerRegistrationStatus.WITHDRAWN ? (
              <Notice tone="info" title={t('myReg.withdrewTitle')}>
                {t('myReg.withdrewBody', { date: date(latest.reviewedAt ?? latest.submittedAt) })}
              </Notice>
            ) : null}
            <Timeline label={t('myReg.timeline')}>
              <TimelineItem
                state="done"
                stateLabel={t('myReg.sent')}
                title={t('myReg.sent')}
                meta={at(latest.submittedAt)}
              />
              {latest.status === OwnerRegistrationStatus.REJECTED ? (
                <TimelineItem
                  state="stopped"
                  stateLabel={t('myReg.status.REJECTED')}
                  title={t('myReg.status.REJECTED')}
                  meta={latest.reviewedAt === null ? undefined : at(latest.reviewedAt)}
                  last
                />
              ) : latest.status === OwnerRegistrationStatus.WITHDRAWN ? (
                <TimelineItem
                  state="stopped"
                  stateLabel={t('myReg.status.WITHDRAWN')}
                  title={t('myReg.status.WITHDRAWN')}
                  meta={t('myReg.youAt', {
                    date: date(latest.reviewedAt ?? latest.submittedAt),
                    time: formatTime(latest.reviewedAt ?? latest.submittedAt, locale),
                  })}
                  last
                />
              ) : (
                <>
                  <TimelineItem
                    state={latest.status === OwnerRegistrationStatus.PENDING ? 'current' : 'done'}
                    stateLabel={t(`myReg.status.${latest.status}`)}
                    title={t('myReg.reviews')}
                    meta={t('myReg.reviewsNote')}
                  />
                  <TimelineItem
                    state={latest.status === OwnerRegistrationStatus.APPROVED ? 'done' : 'upcoming'}
                    stateLabel={t(`myReg.status.${latest.status}`)}
                    title={t('myReg.opens')}
                    meta={t('myReg.opensNote')}
                    last
                  />
                </>
              )}
            </Timeline>
            {latest.status === OwnerRegistrationStatus.PENDING ? (
              <Button variant="outline" className="self-start" onClick={() => setWithdrawing(true)}>
                {t('myReg.withdraw')}
              </Button>
            ) : latest.status === OwnerRegistrationStatus.APPROVED ? null : (
              <ApplyLink>{t('myReg.applyAgain')}</ApplyLink>
            )}
          </Card>
          {earlier.length === 0 ? null : (
            <Card className="flex flex-col gap-3" aria-labelledby="earlier-heading">
              <h2 id="earlier-heading" className="text-lg font-semibold text-foreground">
                {t('myReg.earlier')}
              </h2>
              <ul className="flex flex-col divide-y divide-border">
                {earlier.map((registration) => (
                  <li
                    key={registration.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                  >
                    <span className="text-foreground">
                      {t('myReg.sentOn', { date: date(registration.submittedAt) })}
                    </span>
                    <StatusBadge tone={REGISTRATION_TONES[registration.status]}>
                      {t(`myReg.status.${registration.status}`)}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <WhatYouSent registration={latest} />
      </div>
      <ConfirmDialog
        open={withdrawing}
        onOpenChange={(open) => {
          setWithdrawing(open);
          if (!open) setAlert(null);
        }}
        title={t('myReg.withdrawTitle')}
        description={t('myReg.withdrawBody')}
        confirm={t('myReg.withdrawConfirm')}
        busy={busy ? t('action.saving') : undefined}
        alert={alert ?? undefined}
        labels={{ cancel: t('myReg.keep'), close: t('action.close') }}
        onConfirm={() => void withdraw()}
      />
    </>
  );
}
