'use client';

import { adminPlansLookupPrice, adminPlansRegisterPrice, ApiError } from '@wayfare/api-client';
import type { AdminPlanResponseDto, PriceLookupResponseDto } from '@wayfare/api-client';
import { zStripePriceId } from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@wayfare/ui/dialog';
import { Field, FormAlert, Input } from '@wayfare/ui/field';
import { toast } from '@wayfare/ui/toaster';
import { CircleCheck } from 'lucide-react';
import { useRef, useState } from 'react';
import { errorText } from '../client/errors';
import type { Translator } from '../i18n/messages';
import { useConsole } from '../i18n/provider';
import { formatMoney } from './grants';

type Interval = 'MONTH' | 'YEAR';
/** A placeholder in Stripe's own shape: the field is pasted from its dashboard. */
const PRICE_EXAMPLE = 'price_1QyGrM12usd';

/** Stripe's refusal under its field (B4b, B4c): by the issue's code. */
function refusalText(error: unknown, interval: Interval, plan: string, translator: Translator) {
  const { t } = translator;
  if (!(error instanceof ApiError)) return { field: null, alert: errorText(error, translator) };
  if (error.code === 'INVALID_STATE') return { field: null, alert: t('price.assigned', { plan }) };
  if (error.code === 'UPSTREAM_UNAVAILABLE') return { field: null, alert: t('price.noAnswer') };
  if (error.code !== 'VALIDATION_FAILED')
    return { field: null, alert: errorText(error, translator) };
  const code = (error.details as { issues?: { code?: string }[] } | undefined)?.issues?.[0]?.code;
  switch (code) {
    case 'currency':
      return { field: t('price.currency'), alert: null };
    case 'interval_mismatch':
      // The refusal doesn't say the price's interval; of the two offered, it's the other one.
      return {
        field: t('price.interval', {
          interval: interval === 'MONTH' ? t('price.year') : t('price.month'),
        }),
        alert: null,
      };
    case 'product_mismatch':
      return { field: t('price.product', { plan }), alert: null };
    case 'amount':
      return { field: t('price.amount'), alert: null };
    case 'taken':
      return { field: t('price.taken'), alert: null };
    default:
      return { field: t('price.notFound'), alert: null };
  }
}

/**
 * Register a price (B4–B4c): the Stripe price ID and its interval; the amount is never typed. Once
 * Stripe answers — on leaving the field, or choosing the other interval — its amount and product
 * show with the price it replaces, and *Register price* turns on.
 */
export function RegisterPriceDialog({
  plan,
  open,
  onOpenChange,
  onRegistered,
}: {
  plan: AdminPlanResponseDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRegistered: () => void;
}) {
  const translator = useConsole();
  const { t } = translator;
  const [priceId, setPriceId] = useState('');
  const [interval, setInterval] = useState<Interval>('MONTH');
  const [answer, setAnswer] = useState<PriceLookupResponseDto | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The latest look-up wins: an earlier answer arriving late is dropped.
  const asked = useRef(0);

  const reset = () => {
    setPriceId('');
    setInterval('MONTH');
    setAnswer(null);
    setFieldError(undefined);
    setAlert(null);
  };
  const change = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const lookUp = (id: string, chosen: Interval) => {
    setAnswer(null);
    setFieldError(undefined);
    setAlert(null);
    const trimmed = id.trim();
    if (trimmed === '') return;
    if (!zStripePriceId.safeParse(trimmed).success) {
      setFieldError(t('price.notFound'));
      return;
    }
    const ask = ++asked.current;
    adminPlansLookupPrice(plan.id, { stripePriceId: trimmed, billingInterval: chosen }).then(
      ({ data }) => {
        if (ask === asked.current) setAnswer(data);
      },
      (error: unknown) => {
        if (ask !== asked.current) return;
        const refusal = refusalText(error, chosen, plan.name, translator);
        setFieldError(refusal.field ?? undefined);
        setAlert(refusal.alert);
      },
    );
  };

  const register = () => {
    setBusy(true);
    adminPlansRegisterPrice(plan.id, {
      stripePriceId: priceId.trim(),
      billingInterval: interval,
    }).then(
      () => {
        setBusy(false);
        change(false);
        toast.success(t('price.registered'));
        onRegistered();
      },
      (error: unknown) => {
        setBusy(false);
        setAnswer(null);
        const refusal = refusalText(error, interval, plan.name, translator);
        setFieldError(refusal.field ?? undefined);
        setAlert(refusal.alert);
      },
    );
  };

  const amount = answer === null ? '' : formatMoney(answer.amount);
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent closeLabel={t('action.close')}>
        <DialogHeader title={t('price.title', { plan: plan.name })} />
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (answer !== null) register();
          }}
        >
          <Field
            label={t('price.id')}
            required
            help={t('price.idHelp', { plan: plan.name })}
            error={fieldError}
          >
            {(control) => (
              <Input
                {...control}
                className="font-mono"
                placeholder={PRICE_EXAMPLE}
                autoComplete="off"
                spellCheck={false}
                value={priceId}
                onChange={(event) => {
                  setPriceId(event.target.value);
                  setAnswer(null);
                }}
                // The field's own value: a blur can come before the typed value's render.
                onBlur={(event) => lookUp(event.target.value, interval)}
              />
            )}
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium text-foreground">
              {t('price.intervalLabel')}
              <span aria-hidden className="ml-1 text-destructive">
                *
              </span>
            </legend>
            <div className="flex gap-6">
              {(['MONTH', 'YEAR'] as const).map((value) => (
                <label key={value} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="price-interval"
                    className="size-4 accent-primary"
                    checked={interval === value}
                    onChange={() => {
                      setInterval(value);
                      lookUp(priceId, value);
                    }}
                  />
                  {value === 'MONTH' ? t('plans.monthly') : t('plans.yearly')}
                </label>
              ))}
            </div>
          </fieldset>
          <div role="status">
            {answer === null ? null : (
              <div className="flex flex-col gap-4 duration-(--duration-fast) animate-in fade-in motion-reduce:animate-none">
                <div className="flex items-start gap-2 rounded-md bg-muted px-4 py-3 text-sm">
                  <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div className="flex flex-col gap-1">
                    <span className="font-medium text-foreground">
                      {answer.interval === 'MONTH'
                        ? t('price.aMonth', { amount })
                        : t('price.aYear', { amount })}
                    </span>
                    <span className="text-xs break-all text-muted-foreground">
                      {t('price.stripes', { plan: plan.name, product: answer.productId })}
                    </span>
                  </div>
                </div>
                {answer.replaces === null ? null : (
                  <p className="text-sm text-foreground">
                    {t(
                      answer.interval === 'MONTH'
                        ? 'price.replacesMonthly'
                        : 'price.replacesYearly',
                      {
                        amount: formatMoney(answer.replaces.amount),
                        new: amount,
                      },
                    )}
                  </p>
                )}
              </div>
            )}
          </div>
          {alert === null ? null : <FormAlert>{alert}</FormAlert>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => change(false)}>
              {t('action.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={answer === null}
              busy={busy ? t('price.register') : undefined}
            >
              {t('price.register')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
