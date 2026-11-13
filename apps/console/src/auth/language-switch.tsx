'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@wayfare/ui/menu';
import { ChevronDown, Languages } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { setPageCookie } from '../client/cookies';
import { LANGUAGE_COOKIE } from '../i18n/language';
import { CONSOLE_LOCALES } from '../i18n/messages';
import { useConsole } from '../i18n/provider';

/**
 * The language switch under the card (K6): it shows the language the page is already in, so a
 * visitor changes it only when it is wrong; a change is remembered for the signed-out pages.
 */
export function LanguageSwitch() {
  const { t, locale } = useConsole();
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <Languages aria-hidden className="size-4" />
        <span className="sr-only">{t('signIn.language')}: </span>
        {t(`language.${locale}`)}
        <ChevronDown aria-hidden className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center">
        <DropdownMenuRadioGroup
          value={locale}
          onValueChange={(value) => {
            setPageCookie(LANGUAGE_COOKIE, value);
            router.refresh();
          }}
        >
          {CONSOLE_LOCALES.map((option) => (
            <DropdownMenuRadioItem key={option} value={option} lang={option}>
              {t(`language.${option}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
