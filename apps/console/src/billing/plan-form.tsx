'use client';

import { adminPlansCreate, adminPlansUpdate, ApiError } from '@wayfare/api-client';
import type { AdminPlanResponseDto } from '@wayfare/api-client';
import { PLATFORM_CEILINGS, zPlanCode } from '@wayfare/contracts';
import type { LimitDimension } from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { LeaveDialog } from '@wayfare/ui/dialogs';
import { Field, FieldError, FormAlert, Input } from '@wayfare/ui/field';
import { FormSection, SaveBar, useLeaveGuard } from '@wayfare/ui/form';
import { PageHeader } from '@wayfare/ui/list';
import { toast } from '@wayfare/ui/toaster';
import { Info, Lock } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { errorText } from '../client/errors';
import type { FieldErrors } from '../forms/field-errors';
import { useConsole } from '../i18n/provider';
import {
  EMPTY_DRAFT,
  LIMIT_MIN,
  MAX_COMMISSION_PERCENT,
  checkGrants,
  draftOf,
  scopeLanguages,
  vouchersPaused,
} from './grants';
import type { GrantsDraft } from './grants';
import { PausedNote } from './grants-table';

type Plan = AdminPlanResponseDto;

/** Each limit's example: a plausible plan's, never Growth's, so a new plan doesn't look filled in. */
const LIMIT_EXAMPLES: Readonly<Record<LimitDimension, number>> = {
  maxPlaces: 5,
  maxPhotosPerPlace: 6,
  maxMenuItemsPerPlace: 50,
  aiCreditsPerDay: 5,
  discoveryBoostSlots: 0,
};

/** A radio group of the form's (auto-narration, languages, analytics): each choice with its meaning. */
function Choices<V extends string | boolean>({
  name,
  label,
  value,
  options,
  error,
  help,
  onChange,
}: {
  name: string;
  label: string;
  value: V | null;
  options: readonly { value: V; label: string; hint?: string }[];
  error: string | undefined;
  help?: string;
  onChange: (value: V) => void;
}) {
  const id = useId();
  return (
    <fieldset
      className="flex flex-col gap-2"
      aria-describedby={
        [help === undefined ? null : `${id}-help`, error === undefined ? null : `${id}-error`]
          .filter((part) => part !== null)
          .join(' ') || undefined
      }
    >
      <legend className="mb-2 text-sm font-medium text-foreground">
        {label}
        <span aria-hidden className="ml-1 text-destructive">
          *
        </span>
      </legend>
      {options.map((option) => (
        <label key={String(option.value)} className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name={name}
            className="mt-0.5 size-4 accent-primary"
            checked={value === option.value}
            aria-invalid={error === undefined ? undefined : true}
            onChange={() => onChange(option.value)}
          />
          <span className="flex flex-col">
            <span className="text-foreground">{option.label}</span>
            {option.hint === undefined ? null : (
              <span className="text-xs text-muted-foreground">{option.hint}</span>
            )}
          </span>
        </label>
      ))}
      {help === undefined ? null : (
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {help}
        </p>
      )}
      {error === undefined ? null : <FieldError id={`${id}-error`}>{error}</FieldError>}
    </fieldset>
  );
}

/**
 * A new plan or a plan's edit (B3–B3c, K12): about the plan, then every grant — none has a
 * default — each checked against its ceiling before sending; the commission field only while
 * vouchers are sold. The code is fixed once created. Saving changes no subscriber until the plan is
 * applied.
 */
export function PlanForm({ plan }: { plan: Plan | null }) {
  const translator = useConsole();
  const { t, tDynamic } = translator;
  const router = useRouter();
  const [code, setCode] = useState(plan?.code ?? '');
  const [name, setName] = useState(plan?.name ?? '');
  const [order, setOrder] = useState(plan === null ? '' : String(plan.sortOrder));
  const [shown, setShown] = useState(plan?.isActive ?? false);
  const [draft, setDraft] = useState<GrantsDraft>(
    plan === null ? EMPTY_DRAFT : draftOf(plan.grants),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  // The API's refusals stay beside their fields until the field changes: a later check of the
  // others doesn't hide them (B3b keeps the taken code beside the typed ceiling).
  const [refused, setRefused] = useState<FieldErrors>({});
  const fieldErrors: FieldErrors = { ...refused, ...errors };
  const touch = (field: string) =>
    setRefused((current) => {
      if (current[field] === undefined) return current;
      const { [field]: _gone, ...rest } = current;
      return rest;
    });
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [leaving, setLeaving] = useState<string | null>(null);
  const initial = plan === null ? EMPTY_DRAFT : draftOf(plan.grants);
  const top = useRef<HTMLDivElement>(null);
  // The alert above the form says what's wrong: bring it into view (B3b).
  const showAlert = () =>
    requestAnimationFrame(() => top.current?.scrollIntoView({ block: 'start' }));
  const dirty =
    !saved &&
    (code !== (plan?.code ?? '') ||
      name !== (plan?.name ?? '') ||
      order !== (plan === null ? '' : String(plan.sortOrder)) ||
      shown !== (plan?.isActive ?? false) ||
      JSON.stringify(draft) !== JSON.stringify(initial));
  useLeaveGuard(dirty && leaving === null && !busy, setLeaving);
  const back = plan === null ? '/billing/plans' : `/billing/plans/${plan.id}`;
  const set = <K extends keyof GrantsDraft>(key: K, value: GrantsDraft[K]) => {
    touch(key);
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const submit = () => {
    const found: FieldErrors = {};
    if (plan === null && !zPlanCode.safeParse(code).success)
      found.code = code === '' ? t('issue.required') : t('planForm.codeShape');
    if (name.trim() === '') found.name = t('issue.required');
    const orderValue = Number(order);
    if (order.trim() === '') found.sortOrder = t('issue.required');
    else if (!/^\d+$/.test(order.trim()) || orderValue > 32_767)
      found.sortOrder = t('grants.range', { min: 0, max: 32_767 });
    const checked = checkGrants(draft, translator);
    Object.assign(found, checked.errors ?? {});
    setErrors(found);
    setAlert(null);
    if (
      Object.keys(found).length > 0 ||
      Object.keys(refused).length > 0 ||
      checked.grants === null
    ) {
      showAlert();
      return;
    }
    setBusy(true);
    const request =
      plan === null
        ? adminPlansCreate({
            code,
            name: name.trim(),
            sortOrder: orderValue,
            isActive: shown,
            grants: checked.grants,
          })
        : adminPlansUpdate(plan.id, {
            name: name.trim(),
            sortOrder: orderValue,
            isActive: shown,
            grants: checked.grants,
          });
    request.then(
      ({ data }) => {
        setBusy(false);
        setSaved(true);
        toast.success(plan === null ? t('planForm.created') : t('planForm.saved'));
        router.push(`/billing/plans/${data.plan.id}`);
        router.refresh();
      },
      (error: unknown) => {
        setBusy(false);
        if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
          const issues =
            (error.details as { issues?: { path?: string; code?: string }[] } | undefined)
              ?.issues ?? [];
          const server: FieldErrors = {};
          for (const issue of issues) {
            const [, top, grant] = (issue.path ?? '').split('/');
            if (top === 'code')
              server.code =
                issue.code === 'taken' ? t('planForm.codeTaken', { code }) : t('issue.generic');
            else if (top === 'grants' && grant !== undefined && grant in PLATFORM_CEILINGS)
              server[grant] = t('grants.overCeiling', {
                max: PLATFORM_CEILINGS[grant as LimitDimension],
                grant: tDynamic(`grants.noun.${grant}`),
              });
            else if (top !== undefined && top !== '') server[top] = t('issue.generic');
          }
          if (Object.keys(server).length > 0) {
            setRefused(server);
            showAlert();
            return;
          }
        }
        setAlert(errorText(error, translator));
        showAlert();
      },
    );
  };

  const count = Object.values(fieldErrors).filter((value) => value !== undefined).length;
  const limit = (key: LimitDimension, help: string): ReactNode => (
    <Field label={tDynamic(`grants.${key}`)} required help={help} error={fieldErrors[key]}>
      {(control) => (
        <Input
          {...control}
          inputMode="numeric"
          placeholder={t('planForm.example', { value: LIMIT_EXAMPLES[key] })}
          value={draft[key]}
          onChange={(event) => set(key, event.target.value)}
        />
      )}
    </Field>
  );
  const range = (key: LimitDimension) =>
    LIMIT_MIN[key] === 1
      ? t('planForm.rangeMost', { max: PLATFORM_CEILINGS[key] })
      : t('planForm.range', { max: PLATFORM_CEILINGS[key] });

  return (
    <>
      <PageHeader
        breadcrumb={
          <span className="text-sm text-muted-foreground">
            <Link href="/billing/plans" className="hover:underline">
              {t('plans.title')}
            </Link>
            {plan === null ? null : (
              <>
                {' / '}
                <Link href={`/billing/plans/${plan.id}`} className="hover:underline">
                  {plan.name}
                </Link>
              </>
            )}
          </span>
        }
        title={
          plan === null ? t('planForm.newTitle') : t('planForm.editTitle', { name: plan.name })
        }
        description={t('planForm.lead')}
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
              <p>
                {plan === null
                  ? t('planForm.attentionBody', { n: count })
                  : t('planForm.attentionBodyEdit', { n: count })}
              </p>
            </FormAlert>
          ) : alert === null ? null : (
            <FormAlert>{alert}</FormAlert>
          )}
          {plan === null ? null : (
            <div
              role="status"
              className="flex items-start gap-2 rounded-md bg-info px-4 py-3 text-sm text-info-foreground"
            >
              <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
              <p>{t('planForm.editNote', { name: plan.name, n: plan.subscribers.total })}</p>
            </div>
          )}
          <FormSection title={t('planForm.about')}>
            <div className="grid gap-4 md:grid-cols-2">
              {plan === null ? (
                <Field
                  label={t('plans.code')}
                  required
                  help={t('planForm.codeHelp')}
                  error={fieldErrors.code}
                >
                  {(control) => (
                    <Input
                      {...control}
                      className="font-mono"
                      placeholder={t('planForm.example', { value: 'HOI_AN_PARTNERS' })}
                      autoComplete="off"
                      spellCheck={false}
                      value={code}
                      onChange={(event) => {
                        touch('code');
                        setCode(event.target.value.toUpperCase());
                      }}
                    />
                  )}
                </Field>
              ) : (
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-foreground">{t('plans.code')}</span>
                  <span className="flex items-center gap-2 text-sm text-foreground">
                    <Lock aria-hidden className="size-4 text-muted-foreground" />
                    <span className="font-mono">{plan.code}</span>
                  </span>
                  <p className="text-xs text-muted-foreground">{t('planForm.codeFixed')}</p>
                </div>
              )}
              <Field
                label={t('planForm.name')}
                required
                help={t('planForm.nameHelp')}
                error={fieldErrors.name}
              >
                {(control) => (
                  <Input
                    {...control}
                    placeholder={t('planForm.example', { value: t('planForm.namePlaceholder') })}
                    value={name}
                    onChange={(event) => {
                      touch('name');
                      setName(event.target.value);
                    }}
                  />
                )}
              </Field>
              <Field
                label={t('plans.order')}
                required
                help={t('planForm.orderHelp')}
                error={fieldErrors.sortOrder}
              >
                {(control) => (
                  <Input
                    {...control}
                    inputMode="numeric"
                    placeholder={t('planForm.example', { value: 4 })}
                    value={order}
                    onChange={(event) => {
                      touch('sortOrder');
                      setOrder(event.target.value);
                    }}
                  />
                )}
              </Field>
            </div>
            <label className="flex items-center gap-2 self-start text-sm text-foreground">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={shown}
                onChange={(event) => setShown(event.target.checked)}
              />
              {t('planForm.shown')}
            </label>
          </FormSection>
          <FormSection title={t('plans.grants')}>
            <p className="text-xs text-muted-foreground">{t('planForm.grantsLead')}</p>
            <div className="grid gap-4 md:grid-cols-2">
              {limit('maxPlaces', range('maxPlaces'))}
              {limit('maxPhotosPerPlace', range('maxPhotosPerPlace'))}
              {limit('maxMenuItemsPerPlace', range('maxMenuItemsPerPlace'))}
              {limit('aiCreditsPerDay', `${range('aiCreditsPerDay')} ${t('planForm.aiHelp')}`)}
              {limit(
                'discoveryBoostSlots',
                `${range('discoveryBoostSlots')} ${t('planForm.boostHelp')}`,
              )}
            </div>
            <Choices
              name="auto-narration"
              label={t('grants.autoNarration')}
              value={draft.autoNarration}
              error={fieldErrors.autoNarration}
              help={t('planForm.autoHelp')}
              options={[
                { value: true, label: t('grants.autoOn') },
                { value: false, label: t('grants.autoOff') },
              ]}
              onChange={(value) => set('autoNarration', value)}
            />
            <Choices
              name="languages"
              label={t('grants.narrationLanguageScope')}
              value={draft.narrationLanguageScope}
              error={fieldErrors.narrationLanguageScope}
              options={(['BASIC', 'LAUNCH', 'EXTENDED'] as const).map((scope) => ({
                value: scope,
                label: tDynamic(`grants.scope.${scope}`),
                ...(scope === 'BASIC' ? {} : { hint: scopeLanguages(scope, translator) }),
              }))}
              onChange={(value) => set('narrationLanguageScope', value)}
            />
            <Choices
              name="analytics"
              label={t('grants.analyticsLevel')}
              value={draft.analyticsLevel}
              error={fieldErrors.analyticsLevel}
              options={(['NONE', 'BASIC', 'FULL'] as const).map((level) => ({
                value: level,
                label: tDynamic(`grants.analytics.${level}`),
                ...(level === 'BASIC' ? { hint: t('planForm.analyticsBasic') } : {}),
              }))}
              onChange={(value) => set('analyticsLevel', value)}
            />
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium text-foreground">
                {t('grants.canSellVouchers')}
              </legend>
              <label className="flex items-center gap-2 self-start text-sm text-foreground">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={draft.canSellVouchers}
                  onChange={(event) => set('canSellVouchers', event.target.checked)}
                />
                {t('planForm.sellVouchers')}
              </label>
              {vouchersPaused() ? <PausedNote /> : null}
            </fieldset>
            {/* Only while vouchers are sold, so a commission without selling can't be typed (K12). */}
            <div aria-live="polite">
              {draft.canSellVouchers ? (
                <div className="grid gap-4 duration-(--duration-normal) animate-in fade-in md:grid-cols-2 motion-reduce:animate-none">
                  <Field
                    label={t('planForm.commission')}
                    required
                    help={t('planForm.commissionHelp', { max: MAX_COMMISSION_PERCENT })}
                    error={fieldErrors.commissionPercent}
                  >
                    {(control) => (
                      <Input
                        {...control}
                        inputMode="numeric"
                        placeholder={t('planForm.example', { value: 12 })}
                        value={draft.commissionPercent}
                        onChange={(event) => set('commissionPercent', event.target.value)}
                      />
                    )}
                  </Field>
                </div>
              ) : null}
            </div>
          </FormSection>
        </div>
        <SaveBar>
          <p className="mr-auto self-center text-xs text-muted-foreground">
            {t('planForm.saveNote')}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => (dirty ? setLeaving(back) : router.push(back))}
          >
            {t('action.cancel')}
          </Button>
          <Button
            type="submit"
            busy={busy ? (plan === null ? t('planForm.create') : t('planForm.save')) : undefined}
          >
            {plan === null ? t('planForm.create') : t('planForm.save')}
          </Button>
        </SaveBar>
      </form>
      <LeaveDialog
        open={leaving !== null}
        onOpenChange={(open) => {
          if (!open) setLeaving(null);
        }}
        title={t('leave.title')}
        description={t('leave.body', { name: name || t('planForm.newTitle') })}
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
