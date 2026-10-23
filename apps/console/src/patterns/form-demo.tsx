'use client';

import { usersMe } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { LeaveDialog } from '@wayfare/ui/dialogs';
import { Field, FormAlert, Input, Textarea } from '@wayfare/ui/field';
import { FormSection, SaveBar, useLeaveGuard } from '@wayfare/ui/form';
import { PageHeader } from '@wayfare/ui/list';
import { toast } from '@wayfare/ui/toaster';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { z } from 'zod';
import { errorText } from '../client/errors';
import { errorCount, validateForm } from '../forms/field-errors';
import type { FieldErrors } from '../forms/field-errors';
import { useConsole } from '../i18n/provider';
import { useReauthSave } from '../session/reauth';
import { useMe } from '../shell/me';
import { SAMPLE_PLACES } from './sample';

/** The sample form's rules, as a Place's would be (round 34 moves the real ones into contracts). */
const placeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(40).max(2000),
  address: z.string().trim().min(1).max(200),
  phone: z
    .string()
    .trim()
    .regex(/^0\d{9,10}$/u)
    .or(z.literal('')),
});

type Values = Record<keyof z.input<typeof placeSchema>, string>;

const first = SAMPLE_PLACES[0]!;
const INITIAL: Values = {
  name: first.name,
  description: first.description,
  address: first.address,
  phone: first.phone,
};

/**
 * P3: the form page — sections as cards, `*` for required, help under its field, each error beside
 * it and one line above counting them, *Save* and *Cancel* in a bar that stays in view. Leaving with
 * changes asks once (P3b); a save whose session ended asks to sign in over the form (P3c). The save
 * reads `/users/me`, so a real session stands behind it.
 */
export function FormDemo() {
  const translator = useConsole();
  const { t } = translator;
  const me = useMe();
  const router = useRouter();
  const [values, setValues] = useState<Values>(INITIAL);
  const [saved, setSaved] = useState<Values>(INITIAL);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState<string | null>(null);
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);

  useLeaveGuard(dirty && leaving === null, setLeaving);

  const save = useCallback(() => usersMe(), []);
  const { run, dialog } = useReauthSave(save, { email: me.user.email, name: values.name });

  const submit = async () => {
    if (busy) return;
    const checked = validateForm(placeSchema, values, translator, {
      phone: ({ code }) =>
        code === 'invalid_format' || code === 'invalid_union' ? t('issue.phone') : undefined,
    });
    setErrors(checked.ok ? {} : checked.errors);
    setFailure(null);
    if (!checked.ok) return;
    setBusy(true);
    try {
      const done = await run();
      if (done !== undefined) {
        setSaved(values);
        toast.success(t('form.saved'));
      }
    } catch (error) {
      setFailure(errorText(error, translator));
    } finally {
      setBusy(false);
    }
  };
  const field = (name: keyof Values) => ({
    value: values[name],
    onChange: (event: { target: { value: string } }) =>
      setValues((current) => ({ ...current, [name]: event.target.value })),
  });
  const count = errorCount(errors);

  return (
    <section aria-labelledby="p3" className="flex flex-col gap-4">
      <PageHeader
        title={t('form.editPlace')}
        description={t('form.lead')}
        breadcrumb={
          <p className="text-sm text-muted-foreground">
            {t('places.title')} / {saved.name}
          </p>
        }
      />
      <h2 id="p3" className="sr-only">
        P3
      </h2>
      <form
        noValidate
        className="flex max-w-2xl flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {count > 0 ? (
          <FormAlert>{t('form.attention', { count })}</FormAlert>
        ) : failure === null ? null : (
          <FormAlert>{failure}</FormAlert>
        )}
        <FormSection title={t('form.basics')}>
          <Field label={t('field.name')} required error={errors.name}>
            {(control) => <Input {...control} {...field('name')} />}
          </Field>
        </FormSection>
        <FormSection title={t('form.description')}>
          <Field label={t('form.description')} required error={errors.description}>
            {(control) => <Textarea {...control} {...field('description')} />}
          </Field>
        </FormSection>
        <FormSection title={t('form.location')}>
          <Field
            label={t('form.address')}
            required
            help={t('form.addressHelp')}
            error={errors.address}
          >
            {(control) => <Input {...control} {...field('address')} />}
          </Field>
          <Field label={t('form.phone')} error={errors.phone}>
            {(control) => <Input {...control} type="tel" {...field('phone')} />}
          </Field>
        </FormSection>
        <SaveBar>
          <Button
            type="button"
            variant="outline"
            onClick={() => (dirty ? setLeaving('/') : router.push('/'))}
          >
            {t('action.cancel')}
          </Button>
          <Button type="submit" busy={busy ? t('action.saving') : undefined}>
            {t('action.save')}
          </Button>
        </SaveBar>
      </form>
      {dialog}
      <LeaveDialog
        open={leaving !== null}
        onOpenChange={(open) => !open && setLeaving(null)}
        title={t('leave.title')}
        description={t('leave.body', { name: saved.name })}
        stay={t('leave.stay')}
        leave={t('leave.leave')}
        closeLabel={t('action.close')}
        onLeave={() => {
          const href = leaving ?? '/';
          setSaved(values);
          router.push(href);
        }}
      />
    </section>
  );
}
