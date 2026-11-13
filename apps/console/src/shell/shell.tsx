'use client';

import { Button } from '@wayfare/ui/button';
import { cn } from '@wayfare/ui/cn';
import { Dialog, DialogTrigger, DrawerContent, DrawerTitle } from '@wayfare/ui/dialog';
import { Wordmark } from '@wayfare/ui/wordmark';
import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useConsole } from '../i18n/provider';
import { HOME, navigationFor } from '../nav';
import type { NavItem } from '../nav';
import { AccountMenu } from './account-menu';
import { Banners } from './banners';
import { NotificationBell } from './bell';
import { NAV_ICONS } from './icons';
import { useMe } from './me';
import { useQueueCounts } from './queue-counts';
import { SocketProvider } from './socket';

/**
 * The shell (C6–C9): a skip link first; the 256 px sidebar at 1024 px and wider, a drawer from the
 * left below; the bar with the bell, then the account; one banner under it; the page.
 */
export function Shell({ children }: { children: ReactNode }) {
  const { t } = useConsole();
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);

  // Choosing a section closes the drawer.
  useEffect(() => setDrawer(false), [pathname]);

  return (
    <SocketProvider>
      {/* eslint-disable-next-line no-restricted-syntax -- the sidebar's width (w-64), not a spacing step */}
      <div className="min-h-dvh lg:pl-64">
        <a
          href="#content"
          className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          {t('bar.skip')}
        </a>
        <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col overflow-y-auto border-r border-border bg-card lg:flex">
          <div className="px-6 pt-6 pb-4">
            <Wordmark height={32} />
          </div>
          <Navigation />
        </aside>
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background px-4 sm:px-6">
          <Dialog open={drawer} onOpenChange={setDrawer}>
            <DialogTrigger asChild>
              <Button variant="ghost" className="lg:hidden">
                <Menu aria-hidden />
                {t('bar.menu')}
              </Button>
            </DialogTrigger>
            <DrawerContent aria-describedby={undefined}>
              <DrawerTitle className="sr-only">{t('nav.label')}</DrawerTitle>
              <div className="flex items-center justify-between px-6 pt-6 pb-4">
                <Wordmark height={28} />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('bar.closeMenu')}
                  onClick={() => setDrawer(false)}
                >
                  <X aria-hidden />
                </Button>
              </div>
              <Navigation />
            </DrawerContent>
          </Dialog>
          <span className="lg:hidden">
            <Wordmark height={24} />
          </span>
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell />
            <AccountMenu />
          </div>
        </header>
        <Banners />
        <main
          id="content"
          tabIndex={-1}
          className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 outline-none sm:px-6 lg:px-8"
        >
          {children}
        </main>
      </div>
    </SocketProvider>
  );
}

/** The navigation by permission (K5): *Home*, then the groups the person's permissions allow. */
function Navigation() {
  const { t } = useConsole();
  const me = useMe();
  const counts = useQueueCounts();
  const groups = navigationFor(me.permissions, me.ownership);
  return (
    <nav aria-label={t('nav.label')} className="flex flex-col gap-4 px-3 pb-6">
      <ul>
        <NavLink item={HOME} />
      </ul>
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <h2 className="px-3 text-xs font-medium text-muted-foreground">{t(group.label)}</h2>
          <ul className="flex flex-col gap-1">
            {group.items.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                count={item.queue === undefined ? undefined : counts[item.queue]}
              />
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function NavLink({ item, count }: { item: NavItem; count?: number | undefined }) {
  const { t } = useConsole();
  const pathname = usePathname();
  const active =
    item.href === '/'
      ? pathname === '/'
      : pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = NAV_ICONS[item.icon];
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex h-9 items-center gap-3 rounded-md px-3 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
          active
            ? 'bg-accent font-medium text-accent-foreground hover:bg-accent'
            : 'text-foreground',
        )}
      >
        <Icon aria-hidden className="size-4 shrink-0" />
        <span className="flex-1 truncate">{t(item.label)}</span>
        {count === undefined || count === 0 ? null : (
          <>
            <span
              aria-hidden
              data-count
              className="rounded-full bg-primary px-2 text-xs font-medium text-primary-foreground"
            >
              {count}
            </span>
            <span className="sr-only">, {t('nav.count', { count })}</span>
          </>
        )}
      </Link>
    </li>
  );
}
