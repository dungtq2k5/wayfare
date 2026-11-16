'use client';

import { Avatar } from '@wayfare/ui/surfaces';
import { cn } from '@wayfare/ui/cn';
import { Wordmark } from '@wayfare/ui/wordmark';
import { Hash, Heart, Map, Menu, Settings, UserRound, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useState } from 'react';
import { useMe } from '../account/me';
import { useWeb } from '../i18n/provider';
import { LanguagePicker } from './language-picker';
import { useLanguagePicker } from './language-picker-state';

const focusRing = 'outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** The signed-in person's initial, or nothing while it loads. */
function AccountLink({ className }: { className?: string }) {
  const { t } = useWeb();
  const me = useMe();
  const name = me.data?.user.fullName ?? me.data?.user.email ?? '';
  return (
    <Link
      href="/account"
      aria-label={t('shell.account')}
      className={cn('flex size-11 items-center justify-center rounded-md', focusRing, className)}
    >
      <Avatar initial={name.slice(0, 1).toUpperCase()} />
    </Link>
  );
}

/** The phone's menu: the pages the header can't fit, from the right. */
function PhoneMenu({ signedIn }: { signedIn: boolean }) {
  const { t } = useWeb();
  const [open, setOpen] = useState(false);
  const item = (href: string, label: string, Icon: typeof Map) => (
    <Link
      href={href}
      onClick={() => setOpen(false)}
      className={cn(
        'flex min-h-12 items-center gap-3 rounded-md px-3 text-base font-medium text-foreground hover:bg-muted',
        focusRing,
      )}
    >
      <Icon aria-hidden className="size-5 text-muted-foreground" />
      {label}
    </Link>
  );
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        aria-label={t('shell.menu')}
        className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-muted',
          focusRing,
        )}
      >
        <Menu aria-hidden className="size-6" />
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-overlay/50 data-[state=open]:animate-in data-[state=open]:fade-in motion-reduce:animate-none" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-72 max-w-full flex-col gap-1 bg-card p-4 shadow-3 outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right duration-(--duration-normal) motion-reduce:animate-none">
          <div className="flex items-center justify-between pb-2">
            <DialogPrimitive.Title className="text-lg font-semibold text-foreground">
              {t('shell.menu')}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label={t('shell.closeMenu')}
              className={cn(
                'flex size-11 items-center justify-center rounded-md text-foreground hover:bg-muted',
                focusRing,
              )}
            >
              <X aria-hidden className="size-6" />
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sr-only">
            {t('shell.nav')}
          </DialogPrimitive.Description>
          <nav aria-label={t('shell.nav')} className="flex flex-col gap-1">
            {item('/map', t('shell.map'), Map)}
            {item('/favourites', t('shell.favourites'), Heart)}
            {item('/code', t('shell.typeCode'), Hash)}
            {item('/settings', t('shell.settings'), Settings)}
            {signedIn
              ? item('/account', t('shell.account'), UserRound)
              : item('/sign-in', t('shell.signIn'), UserRound)}
          </nav>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * The web header (the handoff's §2): the wordmark, the language button, *Sign in* or the avatar, and
 * a menu on a phone — *Map* and *Favourites* as links, and Settings, from 720 px. Drawn on the page,
 * not in the library.
 */
export function SiteHeader({ signedIn: hinted }: { signedIn: boolean }) {
  const { t } = useWeb();
  const pathname = usePathname();
  const picker = useLanguagePicker();
  const me = useMe();
  // The hint renders the first paint; the account read settles it.
  const signedIn = me.data === undefined ? hinted : me.data !== null;
  const navLink = (href: string, label: string) => {
    const current = pathname === href || pathname.startsWith(`${href}/`);
    return (
      <Link
        href={href}
        aria-current={current ? 'page' : undefined}
        className={cn(
          'rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-muted',
          current && 'bg-accent text-accent-foreground hover:bg-accent',
          focusRing,
        )}
      >
        {label}
      </Link>
    );
  };
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background px-4 tablet:px-6">
      <Link href="/map" aria-label={t('shell.home')} className={cn('rounded-sm', focusRing)}>
        <Wordmark height={24} label={t('app.name')} />
      </Link>
      <nav aria-label={t('shell.nav')} className="hidden gap-1 pl-4 tablet:flex">
        {navLink('/map', t('shell.map'))}
        {navLink('/favourites', t('shell.favourites'))}
      </nav>
      <div className="flex-1" />
      <LanguagePicker open={picker.open} onOpenChange={picker.setOpen} />
      {/* Signed in, the avatar shows at every width: it is how a tourist tells. */}
      {signedIn ? <AccountLink /> : null}
      <div className="hidden items-center gap-2 tablet:flex">
        {signedIn ? null : (
          <Link
            href="/sign-in"
            className={cn(
              'flex h-12 items-center rounded-md px-5 text-base font-semibold text-foreground hover:bg-muted',
              focusRing,
            )}
          >
            {t('shell.signIn')}
          </Link>
        )}
        <Link
          href="/settings"
          aria-label={t('shell.settings')}
          className={cn(
            'flex size-11 items-center justify-center rounded-md text-foreground hover:bg-muted',
            focusRing,
          )}
        >
          <Settings aria-hidden className="size-5" />
        </Link>
      </div>
      <div className="tablet:hidden">
        <PhoneMenu signedIn={signedIn} />
      </div>
    </header>
  );
}
