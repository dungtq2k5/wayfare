'use client';

import { authLogout, usersUpdate } from '@wayfare/api-client';
import { Avatar } from '@wayfare/ui/surfaces';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@wayfare/ui/menu';
import { ChevronDown, Languages, LogOut, Monitor, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { clearPageCookie, setPageCookie, SIGNED_IN_MARKER } from '../client/cookies';
import { useTheme } from '../app/providers';
import { LANGUAGE_COOKIE } from '../i18n/language';
import { CONSOLE_LOCALES } from '../i18n/messages';
import { useConsole } from '../i18n/provider';
import { THEMES, themeOf } from '../theme';
import { initialOf, useMe } from './me';

/** Signs this browser out (C11a): the session's cookies go, and so does the marker. */
export async function signOut(): Promise<void> {
  await authLogout({}, { anonymous: true }).catch(() => undefined);
  clearPageCookie(SIGNED_IN_MARKER);
  window.location.assign('/sign-in');
}

/**
 * The account menu (C11a): who is signed in, *Account*, *Language* and *Appearance* — submenus that
 * apply at once — then *Sign out*. Language is the account's (K12); appearance this browser's (K11).
 */
export function AccountMenu() {
  const { t, locale } = useConsole();
  const me = useMe();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const name = me.user.fullName ?? me.user.email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
        <Avatar initial={initialOf(me)} />
        <span className="sr-only">{t('bar.account')}: </span>
        <span className="hidden max-w-48 truncate sm:inline">{name}</span>
        <ChevronDown aria-hidden className="hidden size-4 text-muted-foreground sm:inline" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col">
          <span className="truncate font-medium text-foreground">{name}</span>
          <span className="truncate text-xs text-muted-foreground">{me.user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push('/account')}>
          <UserRound aria-hidden className="size-4" />
          {t('menu.account')}
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Languages aria-hidden className="size-4" />
            {t('menu.language')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={locale}
              onValueChange={(value) => {
                void usersUpdate({ preferredLocale: value }).then(() => {
                  setPageCookie(LANGUAGE_COOKIE, value);
                  router.refresh();
                });
              }}
            >
              {CONSOLE_LOCALES.map((option) => (
                <DropdownMenuRadioItem key={option} value={option} lang={option}>
                  {t(`language.${option}`)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Monitor aria-hidden className="size-4" />
            {t('menu.appearance')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={theme}
              onValueChange={(value) => setTheme(themeOf(value))}
            >
              {THEMES.map((option) => (
                <DropdownMenuRadioItem key={option} value={option}>
                  {t(`menu.${option}`)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut aria-hidden className="size-4" />
          {t('menu.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
