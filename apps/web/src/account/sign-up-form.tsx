'use client';

import { ApiError, authRegister } from '@wayfare/api-client';
import { LEGAL_DOCUMENT_VERSIONS, LegalDocument } from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { Field, FieldError, FormAlert, Input, PasswordInput } from '@wayfare/ui/field';
import Link from 'next/link';
import { useId, useState } from 'react';
import { useWeb } from '../i18n/provider';
import { AuthPage, OrDivider } from './auth-page';
import { completeSignIn, countSavedHere, safeNext } from './complete-sign-in';
import { GoogleLinkStep } from './google-link-step';
import { GoogleSignIn } from './google-sign-in';
import { useGoogleContinue } from './use-google';

/** The shortest password identity accepts (rdm-spec I-4). */
export const PASSWORD_MIN = 10;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Errors = { email?: string; password?: string; terms?: string };

/**
 * Sign up (WA1b): Google first, then name, email and password, the terms and privacy links opening
 * in a new tab. It claims the browser's device, so its saves stay (K2). A taken address says so
 * twice — at the top and under the field — with *Sign in instead* (WA1c).
 */
export function SignUpForm({ next }: { next: string | null }) {
  const { t, locale } = useWeb();
  const google = useGoogleContinue(next);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [taken, setTaken] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const termsError = useId();
  const signInHref = `/sign-in${next === null ? '' : `?next=${encodeURIComponent(next)}`}`;

  if (google.ticket !== null)
    return <GoogleLinkStep ticket={google.ticket} next={next} onExpired={google.expire} />;

  const submit = async () => {
    const found: Errors = {};
    if (!EMAIL.test(email.trim())) found.email = t('error.emailInvalid');
    if (password.length < PASSWORD_MIN) found.password = t('error.passwordShort');
    if (!agreed) found.terms = t('auth.agreeRequired');
    setErrors(found);
    setTaken(null);
    setAlert(null);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    const savedHere = await countSavedHere(locale);
    try {
      await authRegister({
        email: email.trim(),
        password,
        ...(name.trim() === '' ? {} : { fullName: name.trim() }),
        preferredLocale: locale,
        termsVersion: LEGAL_DOCUMENT_VERSIONS[LegalDocument.TERMS_OF_SERVICE],
      });
      await completeSignIn(safeNext(next) ?? '/account', savedHere, locale);
    } catch (error) {
      setBusy(false);
      if (error instanceof ApiError && error.code === 'EMAIL_TAKEN') {
        setTaken(email.trim());
        setErrors({ email: t('signUp.takenField') });
      } else {
        setAlert(
          error instanceof ApiError && error.status === 0 ? t('error.network') : t('error.generic'),
        );
      }
    }
  };

  return (
    <AuthPage title={t('signUp.title')} lead={t('signUp.lead')}>
      {taken === null ? null : (
        <FormAlert
          action={
            <Link href={signInHref} className="font-medium underline">
              {t('signUp.signInInstead')}
            </Link>
          }
        >
          <span className="block font-medium">{t('signUp.takenTitle')}</span>
          {t('signUp.takenBody', { email: taken })}
        </FormAlert>
      )}
      {alert === null && google.alert === null ? null : (
        <FormAlert>{alert ?? google.alert}</FormAlert>
      )}
      <GoogleSignIn
        onCredential={google.onCredential}
        disabled={google.busy || busy}
        divider={<OrDivider label={t('auth.or')} />}
      />
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label={t('auth.name')} help={t('auth.nameHelp')}>
          {(control) => (
            <Input
              {...control}
              autoComplete="name"
              placeholder={t('auth.namePlaceholder')}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field label={t('auth.email')} error={errors.email}>
          {(control) => (
            <Input
              {...control}
              type="email"
              autoComplete="email"
              placeholder={t('auth.emailPlaceholder')}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </Field>
        <Field label={t('auth.password')} help={t('auth.passwordHelp')} error={errors.password}>
          {(control) => (
            <PasswordInput
              {...control}
              autoComplete="new-password"
              showLabel={t('auth.show')}
              hideLabel={t('auth.hide')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>
        <div className="flex flex-col gap-1">
          <label className="flex items-start gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
              aria-invalid={errors.terms === undefined ? undefined : true}
              aria-describedby={errors.terms === undefined ? undefined : termsError}
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            <span>
              {t('auth.agreeBefore')}
              <a href="/terms" target="_blank" rel="noopener" className="text-primary underline">
                {t('auth.terms')}
              </a>
              {t('auth.and')}
              <a href="/privacy" target="_blank" rel="noopener" className="text-primary underline">
                {t('auth.privacy')}
              </a>
              {t('auth.agreeAfter')}
            </span>
          </label>
          {errors.terms === undefined ? null : (
            <FieldError id={termsError}>{errors.terms}</FieldError>
          )}
        </div>
        <Button type="submit" size="lg" busy={busy ? t('signUp.busy') : undefined}>
          {t('signUp.submit')}
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        {t('signUp.haveAccount')}{' '}
        <Link href={signInHref} className="text-primary underline">
          {t('signUp.signIn')}
        </Link>
      </p>
    </AuthPage>
  );
}
