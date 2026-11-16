'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ApiError, authRefresh, ownerRegistrationSubmit } from '@wayfare/api-client';
import {
  LEGAL_DOCUMENT_VERSIONS,
  MAX_REGISTRATION_NOTE_LENGTH,
  zOwnerRegistrationInput,
} from '@wayfare/contracts';
import { OwnerRegistrationStatus } from '@wayfare/contracts';
import type { OwnerRegistration } from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { Field, FieldError, FormAlert, Input, Textarea } from '@wayfare/ui/field';
import { FormSection, SaveBar } from '@wayfare/ui/form';
import { PageHeader } from '@wayfare/ui/list';
import { toast } from '@wayfare/ui/toaster';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import { errorText } from '../client/errors';
import { LEGAL_BASE_URL } from '../env';
import { errorCount, serverFieldErrors, validateForm } from '../forms/field-errors';
import type { FieldErrors } from '../forms/field-errors';
import { useConsole } from '../i18n/provider';
import { useMe } from '../shell/me';
import { initialAnswers, registrationValues } from './answers';
import type { Answers } from './answers';
import { Notice, REGISTRATIONS_KEY, RegistrationView } from './registration';

/** The owner agreement's reading time, as N4 states it. */
const AGREEMENT_MINUTES = 6;

const digits = (value: string) => value.replace(/\D/g, '').length;

/**
 * Apply (N4, N4b, N6b): five sections and *Send application*. The national ID lives in this
 * component's state alone — never a draft, the URL or a query's cache — and is cleared once sent.
 * An unverified account sees N2b instead of the form.
 */
export function RegistrationForm({ latest }: { latest: OwnerRegistration | null }) {
  const translator = useConsole();
  const { t } = translator;
  const me = useMe();
  const router = useRouter();
  const queries = useQueryClient();
  const acceptError = useId();
  const [answers, setAnswers] = useState<Answers>(() => initialAnswers(latest));
  const [accepted, setAccepted] = useState(false);
  const [fields, setFields] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<
    { kind: 'fix'; count: number } | { kind: 'text'; text: string } | null
  >(null);
  // A newer agreement since the form opened (N4b): said at the agreement, the answers kept.
  const [outdated, setOutdated] = useState(false);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const again = initialAnswers(latest).businessName !== '';

  if (!me.user.isEmailVerified) return <RegistrationView />;

  const set = (field: keyof Answers) => (value: string) =>
    setAnswers((current) => ({ ...current, [field]: value }));

  const overrides = {
    nationalId: () => t('apply.nationalIdDigits', { n: digits(answers.nationalId) }),
    contactPhone: () => t('issue.phone'),
  };

  const submit = async () => {
    if (sending.current) return;
    const values = registrationValues(answers);
    const checked = validateForm(zOwnerRegistrationInput, values, translator, overrides);
    const errors: FieldErrors = checked.ok ? {} : { ...checked.errors };
    // The newer agreement's own alert asks for the acceptance again.
    if (!accepted && !outdated) errors.agreement = t('apply.acceptRequired');
    setFields(errors);
    if (!checked.ok || !accepted) {
      // The agreement to accept again counts too: its alert marks it below.
      setAlert({ kind: 'fix', count: errorCount(errors) + (outdated && !accepted ? 1 : 0) });
      return;
    }
    sending.current = true;
    setBusy(true);
    setAlert(null);
    try {
      await ownerRegistrationSubmit(checked.data).catch(async (error: unknown) => {
        // Verified elsewhere since this session began: a fresh session carries it.
        if (!(error instanceof ApiError) || error.code !== 'EMAIL_NOT_VERIFIED') throw error;
        await authRefresh({});
        return ownerRegistrationSubmit(checked.data);
      });
      // Gone from memory once sent (K2).
      setAnswers((current) => ({ ...current, nationalId: '' }));
      void queries.invalidateQueries({ queryKey: REGISTRATIONS_KEY });
      toast.success(t('apply.sent'));
      router.push('/owner/registration');
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
        const server = serverFieldErrors(error.details, values, translator);
        if (server.nationalId !== undefined) server.nationalId = overrides.nationalId();
        setFields(server);
        setAlert({ kind: 'fix', count: errorCount(server) });
      } else if (error instanceof ApiError && error.code === 'LEGAL_VERSION_OUTDATED') {
        setAccepted(false);
        setOutdated(true);
      } else if (error instanceof ApiError && error.code === 'REGISTRATION_ALREADY_PENDING') {
        setAlert({ kind: 'text', text: t('apply.pending') });
      } else if (error instanceof ApiError && error.code === 'INVALID_STATE') {
        setAlert({ kind: 'text', text: t('apply.alreadyOwner') });
      } else {
        setAlert({ kind: 'text', text: errorText(error, translator) });
      }
      sending.current = false;
      setBusy(false);
    }
  };

  const text = (
    field: keyof Answers,
    label: string,
    options: { help?: string; placeholder: string; optional?: boolean; numeric?: boolean },
  ) => (
    <Field
      label={label}
      required={options.optional !== true}
      help={options.help}
      error={fields[field]}
    >
      {(control) => (
        <Input
          {...control}
          {...(options.numeric === true ? { inputMode: 'numeric' as const } : {})}
          autoComplete={field === 'nationalId' ? 'off' : undefined}
          placeholder={options.placeholder}
          value={answers[field]}
          onChange={(event) => set(field)(event.target.value)}
        />
      )}
    </Field>
  );

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link
            href="/owner/registration"
            className="text-sm text-muted-foreground hover:underline"
          >
            {t('myReg.title')}
          </Link>
        }
        title={again ? t('apply.againTitle') : t('apply.title')}
        description={again ? t('apply.again') : t('apply.lead')}
      />
      <form
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="flex max-w-3xl flex-col gap-6">
          {alert === null ? null : alert.kind === 'fix' ? (
            <FormAlert>
              <span className="block font-medium">{t('apply.fixTitle', { n: alert.count })}</span>
              {t('apply.fixBody', { n: alert.count })}
            </FormAlert>
          ) : (
            <FormAlert>{alert.text}</FormAlert>
          )}
          {again &&
          latest?.status === OwnerRegistrationStatus.REJECTED &&
          latest.decisionNote !== null ? (
            <Notice tone="warning" title={t('myReg.noteFrom')}>
              {t('myReg.quoted', { note: latest.decisionNote })}
            </Notice>
          ) : null}
          <FormSection title={t('apply.business')}>
            {text('businessName', t('apply.businessName'), {
              help: t('apply.businessNameHelp'),
              placeholder: t('apply.businessNamePlaceholder'),
            })}
            {text('businessAddress', t('apply.businessAddress'), {
              placeholder: t('apply.businessAddressPlaceholder'),
            })}
            {text('businessRegistrationNo', t('apply.regNo'), {
              help: t('apply.regNoHelp'),
              placeholder: t('apply.regNoPlaceholder'),
              optional: true,
            })}
          </FormSection>
          <FormSection title={t('apply.contact')}>
            <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
              {text('contactName', t('apply.contactName'), {
                placeholder: t('apply.contactNamePlaceholder'),
              })}
              {text('contactPhone', t('apply.contactPhone'), {
                help: t('apply.contactPhoneHelp'),
                placeholder: t('apply.contactPhonePlaceholder'),
              })}
            </div>
          </FormSection>
          <FormSection title={t('apply.nationalIdSection')}>
            {text('nationalId', t('apply.nationalId'), {
              help: again ? t('apply.nationalIdAgain') : t('apply.nationalIdHelp'),
              placeholder: t('apply.nationalIdPlaceholder'),
              numeric: true,
            })}
            <Notice tone="info" title={t('apply.whyTitle')}>
              {t('apply.whyBody')}
            </Notice>
          </FormSection>
          <FormSection title={t('apply.noteSection')}>
            <Field label={t('apply.note')} help={t('apply.noteHelp')} error={fields.applicantNote}>
              {(control) => (
                <Textarea
                  {...control}
                  rows={3}
                  maxLength={MAX_REGISTRATION_NOTE_LENGTH}
                  placeholder={t('apply.notePlaceholder')}
                  value={answers.applicantNote}
                  onChange={(event) => set('applicantNote')(event.target.value)}
                />
              )}
            </Field>
          </FormSection>
          <FormSection title={t('apply.agreement')}>
            {outdated ? (
              <FormAlert>
                <span className="block font-medium">{t('apply.outdatedTitle')}</span>
                {t('apply.outdatedBody', { version: LEGAL_DOCUMENT_VERSIONS.OWNER_AGREEMENT })}
              </FormAlert>
            ) : null}
            <p className="text-sm text-muted-foreground">
              {t('apply.agreementMeta', {
                version: LEGAL_DOCUMENT_VERSIONS.OWNER_AGREEMENT,
                n: AGREEMENT_MINUTES,
              })}
            </p>
            <ul className="flex list-disc flex-col gap-1 rounded-md bg-muted px-8 py-3 text-sm text-foreground">
              <li>{t('apply.summary1')}</li>
              <li>{t('apply.summary2')}</li>
              <li>{t('apply.summary3')}</li>
            </ul>
            <a
              href={`${LEGAL_BASE_URL}/owner-agreement`}
              target="_blank"
              rel="noreferrer"
              className="self-start rounded-sm text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('apply.readAgreement')}
            </a>
            <div className="flex flex-col gap-1">
              <label className="flex items-start gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  checked={accepted}
                  aria-invalid={fields.agreement === undefined ? undefined : true}
                  aria-describedby={fields.agreement === undefined ? undefined : acceptError}
                  onChange={(event) => {
                    setAccepted(event.target.checked);
                    if (event.target.checked) setOutdated(false);
                  }}
                />
                {t('apply.accept')}
              </label>
              {fields.agreement === undefined ? null : (
                <FieldError id={acceptError}>{fields.agreement}</FieldError>
              )}
            </div>
          </FormSection>
        </div>
        <SaveBar>
          <p className="mr-auto text-sm text-muted-foreground">{t('apply.checked')}</p>
          <Button type="submit" busy={busy ? t('apply.busy') : undefined} disabled={busy}>
            {t('apply.submit')}
          </Button>
        </SaveBar>
      </form>
    </>
  );
}
