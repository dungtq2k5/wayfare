'use client';

import { useQueryClient } from '@tanstack/react-query';
import { adminBillingOverride, ApiError } from '@wayfare/api-client';
import type { BillingAccountDetailResponseDto } from '@wayfare/api-client';
import { PLATFORM_CEILINGS } from '@wayfare/contracts';
import type { LimitDimension } from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { LeaveDialog } from '@wayfare/ui/dialogs';
import { Field, FieldError, FormAlert, Input, Select, Textarea } from '@wayfare/ui/field';
import { FormSection, SaveBar, useLeaveGuard } from '@wayfare/ui/form';
import { PageHeader } from '@wayfare/ui/list';
import { toast } from '@wayfare/ui/toaster';
import { Info } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { errorText } from '../client/errors';
import type { FieldErrors } from '../forms/field-errors';
import { useConsole } from '../i18n/provider';
import { ChangeLine, grantChanges } from './accounts';
import {
  checkGrants,
  draftOf,
  grantLabel,
  grantValue,
  typedGrants,
  vouchersPaused,
} from './grants';
import { PausedNote } from './grants-table';
import type { GrantKey, GrantsDraft } from './grants';
import { ownerName, usePlans } from './words';

type Account = BillingAccountDetailResponseDto;

/** The reason's most, as the audit row keeps it. */
const MAX_REASON = 500;

/**
 * An off-catalogue grant (W3, W3b): each grant beside its plan's value, a required reason, and what
 * changes for the owner — only the grants that differ. Saving pins the account; a grant above its
 * ceiling is refused under its field before sending.
 */
export function GrantForm({ account }: { account: Account }) {
  const translator = useConsole();
  const { t, tDynamic } = translator;
  const router = useRouter();
  const queries = useQueryClient();
  const { name: planName } = usePlans();
  const name = ownerName(account.owner, t('accounts.anOwner'));
  const plan = planName(account.planCode);
  const initial = draftOf(account.entitlements);
  const [draft, setDraft] = useState<GrantsDraft>(initial);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [leaving, setLeaving] = useState<string | null>(null);
  const reasonId = useId();
  const back = `/billing/accounts/${account.id}`;
  const dirty =
    !saved && (JSON.stringify(draft) !== JSON.stringify(initial) || reason.trim() !== '');
  useLeaveGuard(dirty && leaving === null && !busy, setLeaving);
  const set = <K extends keyof GrantsDraft>(key: K, value: GrantsDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const changes = grantChanges(
    account.entitlements,
    typedGrants(draft, account.entitlements),
    translator,
  );
  const top = useRef<HTMLDivElement>(null);
  // The alert above the form says what's wrong: bring it into view, as the plan form does.
  const showAlert = () =>
    requestAnimationFrame(() => top.current?.scrollIntoView({ block: 'start' }));

  const submit = () => {
    const result = checkGrants(draft, translator);
    setErrors(result.errors ?? {});
    setAlert(null);
    if (result.grants === null) {
      showAlert();
      return;
    }
    if (reason.trim() === '') return;
    setBusy(true);
    adminBillingOverride(account.id, { grants: result.grants, reason: reason.trim() }).then(
      ({ data }) => {
        setBusy(false);
        setSaved(true);
        queries.setQueryData(['billing-account', account.id], data.account);
        void queries.invalidateQueries({ queryKey: ['billing-accounts'] });
        toast.success(t('grantForm.saved'));
        router.push(back);
        router.refresh();
      },
      (error: unknown) => {
        setBusy(false);
        if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
          const issues =
            (error.details as { issues?: { path?: string }[] } | undefined)?.issues ?? [];
          const server: FieldErrors = {};
          for (const issue of issues) {
            const [, top, grant] = (issue.path ?? '').split('/');
            if (top === 'grants' && grant !== undefined && grant in PLATFORM_CEILINGS)
              server[grant] = t('grants.overCeiling', {
                max: PLATFORM_CEILINGS[grant as LimitDimension],
                grant: tDynamic(`grants.noun.${grant}`),
              });
          }
          if (Object.keys(server).length > 0) {
            setErrors(server);
            showAlert();
            return;
          }
        }
        setAlert(errorText(error, translator));
        showAlert();
      },
    );
  };

  const count = Object.values(errors).filter((value) => value !== undefined).length;
  const field = (key: GrantKey | 'commissionPercent', control: ReactNode) => {
    const label =
      key === 'commissionPercent' ? t('planForm.commission') : grantLabel(key, translator);
    const planValue =
      key === 'commissionPercent'
        ? account.planGrants.voucherCommissionBps === null
          ? '—'
          : String(account.planGrants.voucherCommissionBps / 100)
        : grantValue(key, account.planGrants, translator, true);
    return (
      <tr key={key} className="align-top">
        <th scope="row" className="py-3 pr-4 text-left font-normal text-foreground">
          {label}
        </th>
        <td className="py-3 pr-4 text-muted-foreground">{planValue}</td>
        <td className="py-2">
          {control}
          {key === 'canSellVouchers' && vouchersPaused() ? <PausedNote /> : null}
          {errors[key] === undefined ? null : <FieldError>{errors[key]}</FieldError>}
        </td>
      </tr>
    );
  };
  const number = (key: LimitDimension | 'commissionPercent') =>
    field(
      key,
      <Input
        aria-label={`${key === 'commissionPercent' ? t('planForm.commission') : grantLabel(key, translator)}, ${t('grantForm.for', { name })}`}
        aria-invalid={errors[key] === undefined ? undefined : true}
        inputMode="numeric"
        placeholder={initial[key] === '' ? '15' : initial[key]}
        value={draft[key]}
        onChange={(event) => set(key, event.target.value)}
      />,
    );
  const choice = <V extends string>(
    key: GrantKey,
    value: V | null,
    options: readonly { value: V; label: string }[],
    onChange: (value: V) => void,
  ) =>
    field(
      key,
      <Select
        aria-label={`${grantLabel(key, translator)}, ${t('grantForm.for', { name })}`}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value as V)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>,
    );

  return (
    <>
      <PageHeader
        breadcrumb={
          <span className="text-sm text-muted-foreground">
            <Link href="/billing/accounts" className="hover:underline">
              {t('accounts.title')}
            </Link>
            {' / '}
            <Link href={back} className="hover:underline">
              {name}
            </Link>
          </span>
        }
        title={t('grantForm.title', { name })}
        description={t('grantForm.lead', { plan })}
      />
      <form
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div ref={top} className="flex max-w-4xl scroll-mt-24 flex-col gap-6">
          {count > 0 ? (
            <FormAlert>
              <p className="font-medium">{t('planForm.attention', { n: count })}</p>
              <p>{t('grantForm.attentionBody', { n: count })}</p>
            </FormAlert>
          ) : alert === null ? null : (
            <FormAlert>{alert}</FormAlert>
          )}
          <div
            role="status"
            className="flex items-start gap-2 rounded-md bg-info px-4 py-3 text-sm text-info-foreground"
          >
            <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
            <p>{t('grantForm.pins')}</p>
          </div>
          <FormSection title={t('account.grants')}>
            <table className="w-full text-sm">
              <caption className="sr-only">{t('account.grants')}</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="w-1/4 py-2 pr-4 font-normal">
                    {t('grants.grant')}
                  </th>
                  <th scope="col" className="w-1/4 py-2 pr-4 font-normal">
                    {t('account.plansGrants', { plan })}
                  </th>
                  <th scope="col" className="py-2 font-normal">
                    {t('grantForm.for', { name })}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {number('maxPlaces')}
                {choice(
                  'autoNarration',
                  draft.autoNarration === null ? null : draft.autoNarration ? 'on' : 'off',
                  [
                    { value: 'on', label: t('grants.on') },
                    { value: 'off', label: t('grants.off') },
                  ],
                  (value) => set('autoNarration', value === 'on'),
                )}
                {choice(
                  'narrationLanguageScope',
                  draft.narrationLanguageScope,
                  (['BASIC', 'LAUNCH', 'EXTENDED'] as const).map((scope) => ({
                    value: scope,
                    label: tDynamic(`grants.scope.${scope}`),
                  })),
                  (value) => set('narrationLanguageScope', value),
                )}
                {(
                  [
                    'maxPhotosPerPlace',
                    'maxMenuItemsPerPlace',
                    'discoveryBoostSlots',
                    'aiCreditsPerDay',
                  ] as const
                ).map((key) => number(key))}
                {choice(
                  'analyticsLevel',
                  draft.analyticsLevel,
                  (['NONE', 'BASIC', 'FULL'] as const).map((level) => ({
                    value: level,
                    label: tDynamic(`grants.analytics.${level}`),
                  })),
                  (value) => set('analyticsLevel', value),
                )}
                {choice(
                  'canSellVouchers',
                  draft.canSellVouchers ? 'yes' : 'no',
                  [
                    { value: 'yes', label: t('accounts.yes') },
                    { value: 'no', label: t('accounts.no') },
                  ],
                  (value) => set('canSellVouchers', value === 'yes'),
                )}
                {draft.canSellVouchers ? number('commissionPercent') : null}
              </tbody>
            </table>
          </FormSection>
          <FormSection title={t('grantForm.why')}>
            <Field label={t('account.reason')} required help={t('grantForm.reasonHelp')}>
              {(control) => (
                <>
                  <Textarea
                    {...control}
                    placeholder={t('grantForm.reasonExample')}
                    maxLength={MAX_REASON}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                  <p
                    id={reasonId}
                    aria-live="polite"
                    className="text-right text-xs text-muted-foreground"
                  >
                    {reason.trim().length} / {MAX_REASON}
                  </p>
                </>
              )}
            </Field>
          </FormSection>
          <FormSection title={t('grantForm.changes', { name })}>
            <div aria-live="polite" className="flex flex-col gap-2 text-sm text-foreground">
              {changes.length === 0 ? (
                <p className="text-muted-foreground">{t('grantForm.noChanges')}</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {changes.map((change) => (
                    <ChangeLine key={change.text} change={change} />
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">{t('grantForm.effect', { name })}</p>
            </div>
          </FormSection>
        </div>
        <SaveBar>
          <Button
            type="button"
            variant="outline"
            onClick={() => (dirty ? setLeaving(back) : router.push(back))}
          >
            {t('action.cancel')}
          </Button>
          <Button
            type="submit"
            disabled={reason.trim() === ''}
            busy={busy ? t('grantForm.save') : undefined}
          >
            {t('grantForm.save')}
          </Button>
        </SaveBar>
      </form>
      <LeaveDialog
        open={leaving !== null}
        onOpenChange={(open) => {
          if (!open) setLeaving(null);
        }}
        title={t('leave.title')}
        description={t('leave.body', { name: t('grantForm.title', { name }) })}
        stay={t('leave.stay')}
        leave={t('leave.leave')}
        closeLabel={t('action.close')}
        onLeave={() => {
          const href = leaving;
          setSaved(true);
          setLeaving(null);
          if (href !== null) router.push(href);
        }}
      />
    </>
  );
}
