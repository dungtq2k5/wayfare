'use client';

import { LANGUAGE_ENGLISH_NAMES, LANGUAGE_NAMES } from '@wayfare/contracts';
import type { Language } from '@wayfare/contracts';
import { cn } from '@wayfare/ui/cn';
import { CircleCheck, Languages, X } from 'lucide-react';
import { Dialog as DialogPrimitive, Popover as PopoverPrimitive } from 'radix-ui';
import type { KeyboardEvent, ReactNode } from 'react';
import { LAUNCH_ORDER, MORE_LANGUAGES, shortName } from '../i18n/language';
import { useWeb } from '../i18n/provider';
import { useChooseLanguage } from '../i18n/use-language';
import { TABLET, useMediaQuery } from '../ui/use-media-query';

/** The rest after the launch languages, by English name (WL1). */
const MORE_BY_NAME = [...MORE_LANGUAGES].sort((a, b) =>
  LANGUAGE_ENGLISH_NAMES[a].localeCompare(LANGUAGE_ENGLISH_NAMES[b]),
);

/** One language, written in itself, its English name under it; a radio-like option. */
function LanguageItem({
  lang,
  selected,
  onChoose,
}: {
  lang: Language;
  selected: boolean;
  onChoose: (lang: Language) => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      lang={lang}
      tabIndex={selected ? 0 : -1}
      onClick={() => onChoose(lang)}
      className={cn(
        'flex min-h-16 w-full items-center gap-4 rounded-lg px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? 'border-2 border-primary bg-accent text-accent-foreground'
          : 'border border-border bg-card text-foreground hover:bg-muted',
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-base font-semibold">{LANGUAGE_NAMES[lang]}</span>
        <span
          lang="en"
          className={cn('text-xs', selected ? 'text-accent-foreground' : 'text-muted-foreground')}
        >
          {LANGUAGE_ENGLISH_NAMES[lang]}
        </span>
      </span>
      {selected ? <CircleCheck aria-hidden className="size-6 shrink-0" /> : null}
    </button>
  );
}

/** Arrow keys move between the options (the handoff's §11): a listbox. */
function moveFocus(event: KeyboardEvent<HTMLDivElement>): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]')];
  const index = options.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : Math.min(options.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)));
  event.preventDefault();
  options[next]?.focus();
}

/** The two groups, launch languages first. */
function LanguageList({ onChosen }: { onChosen: () => void }) {
  const { t, locale } = useWeb();
  const { choose } = useChooseLanguage();
  const pick = (lang: Language) => {
    if (lang !== locale) choose(lang);
    onChosen();
  };
  const group = (title: string, langs: readonly Language[]) => (
    <>
      <p role="presentation" className="pt-4 pb-1 text-sm font-medium text-muted-foreground">
        {title}
      </p>
      {langs.map((lang) => (
        <LanguageItem key={lang} lang={lang} selected={lang === locale} onChoose={pick} />
      ))}
    </>
  );
  return (
    <div
      role="listbox"
      aria-label={t('lang.title')}
      onKeyDown={moveFocus}
      className="flex flex-col gap-1"
    >
      {group(t('lang.launch'), LAUNCH_ORDER)}
      {group(t('lang.more'), MORE_BY_NAME)}
    </div>
  );
}

/**
 * The header's language button: the short name on a phone, the language's own name from 720 px.
 * Its name starts with what it shows, said as the language button.
 */
function LanguageButton({ wide, ...props }: { wide: boolean } & Record<string, unknown>) {
  const { t, locale } = useWeb();
  return (
    <button
      type="button"
      className="flex h-11 shrink-0 items-center gap-1 rounded-md p-3 text-sm font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      {...props}
    >
      <Languages aria-hidden className="size-5" />
      <span className="sr-only">{t('lang.title')}: </span>
      <span lang={locale}>{wide ? LANGUAGE_NAMES[locale] : shortName(locale)}</span>
    </button>
  );
}

/**
 * The language picker (WL1): a full-screen dialog under the header on a phone, a 400 px popover
 * under the language button from 720 px. Opened from the header, and from WQ6's *Choose*.
 */
export function LanguagePicker({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactNode {
  const { t } = useWeb();
  const wide = useMediaQuery(TABLET);
  const close = () => onOpenChange(false);

  if (wide) {
    return (
      <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <PopoverPrimitive.Trigger asChild>
          <LanguageButton wide />
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            align="end"
            sideOffset={4}
            aria-label={t('lang.title')}
            className="z-50 max-h-(--radix-popover-content-available-height) w-100 overflow-y-auto rounded-lg border border-border bg-card p-3 pt-0 shadow-3 outline-none"
          >
            <LanguageList onChosen={close} />
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    );
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Trigger asChild>
        <LanguageButton wide={false} />
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content className="fixed inset-x-0 top-(--header-height) bottom-0 z-40 flex flex-col gap-1 overflow-y-auto bg-background p-4 outline-none">
          <div className="flex items-center gap-2">
            <DialogPrimitive.Title className="flex-1 text-2xl font-semibold text-foreground">
              {t('lang.title')}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label={t('lang.close')}
              className="flex size-11 items-center justify-center rounded-md text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden className="size-6" />
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="text-sm text-muted-foreground">
            {t('lang.lead')}
          </DialogPrimitive.Description>
          <LanguageList onChosen={close} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
