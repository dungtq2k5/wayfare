'use client';

import {
  adminPronunciationsCreate,
  adminPronunciationsPreview,
  adminPronunciationsUpdate,
  ApiError,
} from '@wayfare/api-client';
import type { CreatePronunciationDto, PronunciationEntryResponseDto } from '@wayfare/api-client';
import { MAX_PREVIEW_CHARS, PHONEME_ALPHABETS, zPronunciationInput } from '@wayfare/contracts';
import { AudioPreview } from '@wayfare/ui/audio-preview';
import { Button } from '@wayfare/ui/button';
import { LeaveDialog } from '@wayfare/ui/dialogs';
import { Field, FormAlert, Input, Textarea } from '@wayfare/ui/field';
import { FormSection, SaveBar, useLeaveGuard } from '@wayfare/ui/form';
import { PageHeader } from '@wayfare/ui/list';
import { toast } from '@wayfare/ui/toaster';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { errorText } from '../client/errors';
import { validateForm } from '../forms/field-errors';
import type { FieldErrors } from '../forms/field-errors';
import { autonym, languageName, languageOption } from '../i18n/language-names';
import { useConsole } from '../i18n/provider';
import { ENTRY_LANGUAGES } from './pronunciation';

type Entry = PronunciationEntryResponseDto;
type Kind = CreatePronunciationDto['replacementType'];
type Alphabet = (typeof PHONEME_ALPHABETS)[number];

const ALL = '';
const ALPHABET_NAMES: Record<Alphabet, string> = { ipa: 'IPA', 'x-sampa': 'X-SAMPA' };
const SELECT = 'h-9 rounded-md border border-input bg-background px-2 text-sm';

/**
 * An entry, frames D2–D4: term and language (fixed once saved), how to say it, a note; beside it *Hear it
 * first*, which plays a sample with the draft applied and saves nothing (K15).
 */
export function PronunciationForm({ entry }: { entry: Entry | null }) {
  const translator = useConsole();
  const { t, locale } = translator;
  const router = useRouter();
  const initial = {
    term: entry?.term ?? '',
    targetLang: entry?.targetLang ?? ALL,
    replacementType: entry?.replacementType ?? 'SUB',
    replacement: entry?.replacement ?? '',
    alphabet: (entry?.alphabet ?? 'ipa') as Alphabet,
    note: entry?.note ?? '',
  };
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [exists, setExists] = useState<{ term: string; language: string } | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = !saved && JSON.stringify(values) !== JSON.stringify(initial);
  useLeaveGuard(dirty && leaving === null && !busy, setLeaving);
  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) =>
    setValues((now) => ({ ...now, [key]: value }));

  /** The draft as the API takes it. */
  const draft = () => ({
    term: values.term,
    targetLang: values.targetLang === ALL ? null : values.targetLang,
    replacementType: values.replacementType,
    replacement: values.replacement,
    alphabet: values.replacementType === 'PHONEME' ? values.alphabet : null,
    note: values.note.trim() === '' ? null : values.note,
  });

  const submit = () => {
    const checked = validateForm(zPronunciationInput, draft(), translator);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setExists(null);
    setAlert(null);
    setBusy(true);
    const body = draft();
    const request =
      entry === null
        ? adminPronunciationsCreate(body)
        : adminPronunciationsUpdate(entry.id, {
            replacementType: body.replacementType,
            replacement: body.replacement,
            alphabet: body.alphabet,
            note: body.note,
          });
    request.then(
      () => {
        setBusy(false);
        setSaved(true);
        toast.success(t('pronForm.saved'), {
          description: t('pronForm.savedBody', { term: body.term }),
        });
        router.push('/narration/pronunciation');
      },
      (error: unknown) => {
        setBusy(false);
        if (error instanceof ApiError && error.code === 'PRONUNCIATION_TERM_EXISTS') {
          const details = error.details as { term?: string; targetLang?: string | null };
          setExists({
            term: details.term ?? body.term,
            language:
              (details.targetLang ?? null) === null
                ? t('pron.allLanguages')
                : autonym(details.targetLang!),
          });
        } else setAlert(errorText(error, translator));
      },
    );
  };

  const term = entry?.term ?? values.term;
  return (
    <>
      <PageHeader
        breadcrumb={
          <Link
            href="/narration/pronunciation"
            className="text-sm text-muted-foreground hover:underline"
          >
            {t('pron.title')}
          </Link>
        }
        title={entry === null ? t('pronForm.newTitle') : t('pronForm.editTitle', { term })}
        description={t('pronForm.lead')}
      />
      <form
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-6 lg:col-span-2">
            {alert === null ? null : <FormAlert>{alert}</FormAlert>}
            <FormSection title={t('pronForm.entry')}>
              {entry === null ? (
                <div className="flex flex-col gap-2">
                  <Field
                    label={t('pronForm.term')}
                    required
                    help={t('pronForm.termHelp')}
                    error={
                      errors.term ??
                      (exists === null ? undefined : t('pronForm.termExists', exists))
                    }
                  >
                    {(control) => (
                      <Input
                        {...control}
                        placeholder={t('pronForm.termPlaceholder')}
                        lang="vi"
                        value={values.term}
                        onChange={(event) => {
                          set('term', event.target.value);
                          setExists(null);
                        }}
                      />
                    )}
                  </Field>
                  {exists === null ? null : (
                    <Link
                      href={`/narration/pronunciation?q=${encodeURIComponent(exists.term)}`}
                      className="self-start text-sm font-medium text-primary hover:underline"
                    >
                      {t('pronForm.findIt')}
                    </Link>
                  )}
                </div>
              ) : (
                <ReadOnly label={t('pronForm.term')} help={t('pronForm.termHelp')}>
                  <span lang="vi">{entry.term}</span>
                </ReadOnly>
              )}
              {entry === null ? (
                <Field label={t('pronForm.language')} required help={t('pronForm.languageHelp')}>
                  {(control) => (
                    <select
                      {...control}
                      value={values.targetLang}
                      onChange={(event) => set('targetLang', event.target.value)}
                      className={SELECT}
                    >
                      <option value={ALL}>{t('pron.allLanguages')}</option>
                      {ENTRY_LANGUAGES.map((code) => (
                        <option key={code} value={code}>
                          {languageOption(code, locale)}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              ) : (
                <ReadOnly label={t('pronForm.language')} help={t('pronForm.languageHelp')}>
                  {entry.targetLang === null ? t('pron.allLanguages') : autonym(entry.targetLang)}
                </ReadOnly>
              )}
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-sm font-medium text-foreground">
                  {t('pronForm.sayAs')}
                  <span aria-hidden className="ml-1 text-destructive">
                    *
                  </span>
                </legend>
                {(['SUB', 'PHONEME'] as const).map((kind) => (
                  <label key={kind} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="say-as"
                      className="size-4 accent-primary"
                      checked={values.replacementType === kind}
                      onChange={() => set('replacementType', kind)}
                    />
                    {kind === 'SUB' ? t('pronForm.sayAlias') : t('pronForm.sayPhoneme')}
                  </label>
                ))}
              </fieldset>
              <div className="flex flex-col gap-4 sm:flex-row">
                <Field
                  label={
                    values.replacementType === 'SUB' ? t('pronForm.alias') : t('pronForm.phoneme')
                  }
                  required
                  help={values.replacementType === 'SUB' ? t('pronForm.aliasHelp') : undefined}
                  error={errors.replacement}
                  className="flex-1"
                >
                  {(control) => (
                    <Input
                      {...control}
                      placeholder={
                        values.replacementType === 'SUB'
                          ? t('pronForm.aliasPlaceholder')
                          : t('pronForm.phonemePlaceholder')
                      }
                      value={values.replacement}
                      onChange={(event) => set('replacement', event.target.value)}
                    />
                  )}
                </Field>
                {values.replacementType === 'PHONEME' ? (
                  <Field label={t('pronForm.alphabet')} required error={errors.alphabet}>
                    {(control) => (
                      <select
                        {...control}
                        value={values.alphabet}
                        onChange={(event) => set('alphabet', event.target.value as Alphabet)}
                        className={SELECT}
                      >
                        {PHONEME_ALPHABETS.map((alphabet) => (
                          <option key={alphabet} value={alphabet}>
                            {ALPHABET_NAMES[alphabet]}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                ) : null}
              </div>
              <Field label={t('pronForm.note')} help={t('pronForm.noteHelp')} error={errors.note}>
                {(control) => (
                  <Input
                    {...control}
                    placeholder={t('pronForm.notePlaceholder')}
                    value={values.note}
                    onChange={(event) => set('note', event.target.value)}
                  />
                )}
              </Field>
            </FormSection>
          </div>
          <PreviewCard draft={draft} term={term} language={values.targetLang} />
        </div>
        <SaveBar>
          <p className="mr-auto self-center text-xs text-muted-foreground">
            {t('pronForm.saveNote')}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              dirty
                ? setLeaving('/narration/pronunciation')
                : router.push('/narration/pronunciation')
            }
          >
            {t('action.cancel')}
          </Button>
          <Button type="submit" busy={busy ? t('action.saving') : undefined}>
            {t('pronForm.save')}
          </Button>
        </SaveBar>
      </form>
      <LeaveDialog
        open={leaving !== null}
        onOpenChange={(open) => !open && setLeaving(null)}
        title={t('leave.title')}
        description={t('leave.body', { name: term || t('pronForm.newTitle') })}
        stay={t('leave.stay')}
        leave={t('leave.leave')}
        closeLabel={t('action.close')}
        onLeave={() => {
          setSaved(true);
          router.push(leaving ?? '/narration/pronunciation');
        }}
      />
    </>
  );
}

/** A fixed value where a field was: its label, the value and the field's help. */
function ReadOnly({
  label,
  help,
  children,
}: {
  label: string;
  help: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <span className="text-sm text-foreground">{children}</span>
      <p className="text-xs text-muted-foreground">{help}</p>
    </div>
  );
}

/**
 * *Hear it first*, frames D3–D3c: the language, a sample sentence holding the term, and the player. The
 * draft goes with the request; nothing is saved. No voice and the rate limit are said in the
 * player's place.
 */
function PreviewCard({
  draft,
  term,
  language,
}: {
  draft: () => {
    term: string;
    targetLang: string | null;
    replacementType: Kind;
    replacement: string;
    alphabet: Alphabet | null;
    note: string | null;
  };
  term: string;
  language: string;
}) {
  const translator = useConsole();
  const { t, locale } = translator;
  const [lang, setLang] = useState(language === ALL ? 'en' : language);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The sample follows the term until someone writes their own.
  const sample =
    text ?? (term.trim() === '' ? '' : t('pronForm.sampleText', { term: term.trim() }));

  const load = async () => {
    setError(null);
    const entry = draft();
    if (entry.term.trim().length < 2 || entry.replacement.trim() === '') {
      setError(t('pronForm.fillFirst'));
      throw new Error('no draft');
    }
    try {
      return await adminPronunciationsPreview({
        text: sample.slice(0, MAX_PREVIEW_CHARS),
        lang,
        entries: [{ ...entry, targetLang: entry.targetLang ?? undefined }],
      });
    } catch (failure) {
      setError(previewError(failure));
      throw failure;
    }
  };
  const previewError = (failure: unknown): string => {
    if (failure instanceof ApiError) {
      const details = failure.details as
        { status?: string; retryAfterSeconds?: number } | undefined;
      if (failure.code === 'INVALID_STATE' && details?.status === 'NO_VOICE')
        return t('pronForm.noVoice', { language: languageName(lang, locale) });
      if (failure.code === 'RATE_LIMITED')
        return t('pronForm.tooMany', {
          seconds: Math.max(1, Math.ceil(details?.retryAfterSeconds ?? 60)),
        });
    }
    return errorText(failure, translator);
  };

  return (
    <FormSection title={t('pronForm.hear')}>
      <p className="-mt-2 text-sm text-muted-foreground">{t('pronForm.hearLead')}</p>
      <Field label={t('pronForm.language')} required>
        {(control) => (
          <select
            {...control}
            value={lang}
            onChange={(event) => {
              setLang(event.target.value);
              setError(null);
            }}
            className={SELECT}
          >
            {ENTRY_LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {languageOption(code, locale)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field
        label={t('pronForm.sample')}
        required
        help={t('pronForm.sampleHelp', { max: MAX_PREVIEW_CHARS })}
      >
        {(control) => (
          <Textarea
            {...control}
            // The sentence it is prefilled with, kept as its example once cleared.
            placeholder={t('pronForm.sampleText', {
              term: term.trim() === '' ? t('pronForm.termPlaceholder') : term.trim(),
            })}
            lang={lang}
            rows={3}
            maxLength={MAX_PREVIEW_CHARS}
            value={sample}
            onChange={(event) => setText(event.target.value)}
          />
        )}
      </Field>
      <AudioPreview
        // A new language or sample is a new recording.
        key={`${lang}|${sample}`}
        load={load}
        error={error}
        labels={{
          listen: t('pronForm.listen'),
          playing: t('pronForm.playing'),
          pause: t('pronForm.pause'),
          time: (elapsed, length) => t('pronForm.time', { elapsed, length }),
        }}
      />
    </FormSection>
  );
}
