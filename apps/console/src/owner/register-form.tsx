'use client';

import { ApiError, authRegister } from '@wayfare/api-client';
import { LEGAL_DOCUMENT_VERSIONS, registerBodySchema } from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { Field, FieldError, FormAlert, Input, PasswordInput } from '@wayfare/ui/field';
import { Card } from '@wayfare/ui/surfaces';
import Link from 'next/link';
import { useId, useRef, useState } from 'react';
import { completeSignIn } from '../auth/complete-sign-in';
import { GoogleLinkStep, useGoogleContinue } from '../auth/google-link';
import { GoogleSignIn } from '../auth/google-sign-in';
import { errorText } from '../client/errors';
import { LEGAL_BASE_URL } from '../env';
import { validateForm } from '../forms/field-errors';
import type { FieldErrors } from '../forms/field-errors';
import { useConsole } from '../i18n/provider';

const LINK =
  'rounded-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Register your venue (N1, N1b; K10): an account first — the current terms' version, the page's
 * language — then N2. *Continue with Google* creates one as a tourist's would, then goes to apply.
 */
export function RegisterForm() {
  const translator = useConsole();
  const { t, locale } = translator;
  const termsError = useId();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [fields, setFields] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<{ title: string; body?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const google = useGoogleContinue('/');

  const submit = async () => {
    if (sending.current) return;
    const checked = validateForm(
      registerBodySchema,
      {
        email,
        password,
        ...(fullName.trim() === '' ? {} : { fullName }),
        preferredLocale: locale,
        termsVersion: LEGAL_DOCUMENT_VERSIONS.TERMS_OF_SERVICE,
      },
      translator,
      {
        password: ({ code, count, minimum }) =>
          code === 'too_small' ? t('issue.passwordShort', { count, minimum }) : undefined,
      },
    );
    const errors = { ...(checked.ok ? {} : checked.errors) };
    if (!agreed) errors.terms = t('signUp.termsRequired');
    setFields(errors);
    if (!checked.ok || !agreed) return;
    sending.current = true;
    setBusy(true);
    setAlert(null);
    try {
      const { data } = await authRegister(checked.data, { anonymous: true });
      completeSignIn(data.user, '/owner/register/check-email');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'EMAIL_TAKEN') {
        setAlert({ title: t('signUp.takenTitle'), body: t('signUp.takenBody') });
        setFields({ email: t('signUp.takenField') });
      } else {
        setAlert({ title: errorText(error, translator) });
      }
      setBusy(false);
      sending.current = false;
    }
  };

  if (google.ticket !== null) {
    return <GoogleLinkStep ticket={google.ticket} next="/" onExpired={google.expire} />;
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-primary">{t('signUp.step1')}</p>
        <h1 className="text-2xl font-semibold text-foreground">{t('signUp.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('signUp.lead')}</p>
      </div>
      {alert !== null ? (
        <FormAlert>
          <span className="block font-medium">{alert.title}</span>
          {alert.body}
        </FormAlert>
      ) : google.alert !== null ? (
        <FormAlert>{google.alert}</FormAlert>
      ) : null}
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label={t('signUp.name')} help={t('signUp.nameHelp')} error={fields.fullName}>
          {(control) => (
            <Input
              {...control}
              autoComplete="name"
              placeholder={t('signUp.namePlaceholder')}
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
          )}
        </Field>
        <Field label={t('field.email')} required error={fields.email}>
          {(control) => (
            <Input
              {...control}
              type="email"
              autoComplete="username"
              placeholder={t('field.emailPlaceholder')}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </Field>
        <Field label={t('field.password')} help={t('password.help')} error={fields.password}>
          {(control) => (
            <PasswordInput
              {...control}
              autoComplete="new-password"
              showLabel={t('password.show')}
              hideLabel={t('password.hide')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>
        <div className="flex flex-col gap-1">
          <label className="flex items-start gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-primary"
              checked={agreed}
              aria-invalid={fields.terms === undefined ? undefined : true}
              aria-describedby={fields.terms === undefined ? undefined : termsError}
              onChange={(event) => setAgreed(event.target.checked)}
            />
            <span>
              {t('signUp.agree')}{' '}
              <a href={`${LEGAL_BASE_URL}/terms`} target="_blank" rel="noreferrer" className={LINK}>
                {t('signUp.termsLink')}
              </a>
            </span>
          </label>
          {fields.terms === undefined ? null : (
            <FieldError id={termsError}>{fields.terms}</FieldError>
          )}
        </div>
        <Button
          type="submit"
          busy={busy ? t('signUp.busy') : undefined}
          disabled={busy || google.busy}
        >
          {t('signUp.submit')}
        </Button>
      </form>
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span aria-hidden className="flex-1 border-t border-border" />
        {t('signIn.or')}
        <span aria-hidden className="flex-1 border-t border-border" />
      </div>
      <GoogleSignIn onCredential={google.onCredential} disabled={busy || google.busy} />
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-4 text-sm text-foreground">
        {t('signUp.haveAccount')}
        <Link href="/sign-in" className={LINK}>
          {t('link.signIn')}
        </Link>
      </p>
    </Card>
  );
}
