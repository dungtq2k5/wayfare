'use client';

import { ApiError, placesByCode } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { FieldError, Input, Label } from '@wayfare/ui/field';
import { CircleX, Headphones, QrCode } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import { useWeb } from '../i18n/provider';
import { linkCode, printedCode } from '../places/format';
import { checkTypedCode, formatTyping } from './typed';

/** Round 28's sticker, drawn to show where the code is printed: always light, it is paper. */
function Sticker({ label }: { label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="flex w-30 flex-col items-center gap-1 rounded-xl bg-white px-2 pt-2 pb-2 text-neutral-900 shadow-1"
    >
      <span className="flex items-center gap-0.5 text-xs font-medium">
        <Headphones aria-hidden className="size-3" />
        Wayfare
      </span>
      <QrCode aria-hidden className="size-21" />
      <span className="rounded-sm border border-primary px-1 text-xs font-medium">K7M2 9QXA</span>
    </div>
  );
}

type Outcome = { kind: 'error'; text: string } | { kind: 'gone'; code: string } | null;

/**
 * Code entry (WQ5): the field formats 4 + 4 as it is typed and forgives lower case, spaces and
 * hyphens (round 28); *Open* goes to the Place, a wrong code keeps what was typed with the error
 * under it (WQ5b), and a code no longer listed answers under *Open* (WQ5c).
 */
export function CodeEntry() {
  const { t, locale } = useWeb();
  const router = useRouter();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const errorId = useId();
  const helpId = useId();
  const field = useRef<HTMLInputElement>(null);

  const open = async () => {
    const checked = checkTypedCode(value);
    if (!checked.ok) {
      setOutcome({
        kind: 'error',
        text:
          checked.error === 'short'
            ? t('code.short', { n: checked.count })
            : checked.error === 'letter-u'
              ? t('code.letterU')
              : t('code.symbol'),
      });
      field.current?.focus();
      return;
    }
    setBusy(true);
    setOutcome(null);
    try {
      await placesByCode(checked.code, { lang: locale });
      router.push(`/p/${linkCode(checked.code)}`);
    } catch (error) {
      setBusy(false);
      if (error instanceof ApiError && error.code === 'PLACE_UNAVAILABLE') {
        setOutcome({ kind: 'gone', code: checked.code });
      } else if (error instanceof ApiError && error.status === 404) {
        setOutcome({ kind: 'error', text: t('code.none', { code: printedCode(checked.code) }) });
        field.current?.focus();
      } else {
        setOutcome({
          kind: 'error',
          text:
            error instanceof ApiError && error.status === 0
              ? t('error.network')
              : t('error.generic'),
        });
      }
    }
  };

  const error = outcome?.kind === 'error' ? outcome.text : null;
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-6">
      <h1 className="text-2xl font-semibold text-foreground">{t('code.title')}</h1>
      <p className="text-base text-muted-foreground">{t('code.lead')}</p>
      <Sticker label={t('code.sticker', { code: 'K7M2 9QXA' })} />
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void open();
        }}
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="code">{t('code.label')}</Label>
          <Input
            ref={field}
            id="code"
            name="code"
            value={value}
            onChange={(event) => {
              setValue(formatTyping(event.target.value));
              if (outcome?.kind === 'error') setOutcome(null);
            }}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            maxLength={10}
            placeholder={t('code.placeholder')}
            aria-invalid={error !== null}
            aria-describedby={error === null ? helpId : errorId}
            className="h-12 font-mono text-base font-medium"
          />
          {error === null ? (
            <p id={helpId} className="text-xs text-muted-foreground">
              {t('code.help')}
            </p>
          ) : (
            <div role="alert">
              <FieldError id={errorId}>{error}</FieldError>
            </div>
          )}
        </div>
        <Button type="submit" size="lg" busy={busy ? t('code.opening') : undefined}>
          {t('code.open')}
        </Button>
      </form>
      {outcome?.kind === 'gone' ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4"
        >
          <p className="flex items-center gap-2 text-base font-semibold text-foreground">
            <CircleX aria-hidden className="size-5 shrink-0 text-muted-foreground" />
            {t('code.goneTitle')}
          </p>
          <p className="text-sm text-muted-foreground">
            {t('code.goneBody', { code: printedCode(outcome.code) })}
          </p>
          <Link
            href={`/p/${linkCode(outcome.code)}`}
            className="self-start rounded-sm text-base text-primary underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('code.goneNear')}
          </Link>
        </div>
      ) : error !== null ? null : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <QrCode aria-hidden className="size-5 shrink-0" />
          {t('code.scan')}
        </p>
      )}
    </div>
  );
}
