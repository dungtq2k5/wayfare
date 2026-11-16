'use client';

import { Button } from '@wayfare/ui/button';
import { Heart, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { readPageCookie } from '../client/cookies';
import { readKv, writeKv } from '../client/db';
import { useWeb } from '../i18n/provider';
import { ACCOUNT_HINT_COOKIE } from '../session/account-hint';
import { Sheet } from '../ui/sheet';
import { TABLET, useMediaQuery } from '../ui/use-media-query';
import { offerAfterSave } from './offer-rule';

const SAVES_KEY = 'saves';

const OfferContext = createContext<{ afterSave: () => void } | null>(null);

/**
 * WA1: the save already happened on the browser's anonymous device; a bottom sheet (a dialog from
 * 720 px) then offers an account so saves follow the tourist — after the first save and the third.
 */
export function AccountOfferProvider({ children }: { children: ReactNode }) {
  const { t } = useWeb();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const wide = useMediaQuery(TABLET);
  const afterSave = useCallback(() => {
    void (async () => {
      const saves = (await readKv(SAVES_KEY, 0)) + 1;
      await writeKv(SAVES_KEY, saves);
      if (offerAfterSave(saves, readPageCookie(ACCOUNT_HINT_COOKIE) !== null)) setOpen(true);
    })();
  }, []);
  const next = `?next=${encodeURIComponent(pathname)}`;
  return (
    <OfferContext.Provider value={{ afterSave }}>
      {children}
      {wide ? (
        <OfferDialog open={open} onOpenChange={setOpen} next={next} />
      ) : (
        <Sheet open={open} onOpenChange={setOpen} title={t('offer.title')} titleHidden>
          <div className="flex gap-3 rounded-xl border border-border p-4">
            <Heart aria-hidden className="mt-0.5 size-6 shrink-0 text-primary" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="text-base font-semibold text-foreground">{t('offer.title')}</p>
              <p className="text-sm text-muted-foreground">{t('offer.body')}</p>
              <div className="flex flex-wrap gap-4 pt-2 text-sm font-medium">
                <Link
                  href={`/sign-up${next}`}
                  onClick={() => setOpen(false)}
                  className="text-primary"
                >
                  {t('offer.create')}
                </Link>
                <Link
                  href={`/sign-in${next}`}
                  onClick={() => setOpen(false)}
                  className="text-primary"
                >
                  {t('offer.signIn')}
                </Link>
              </div>
            </div>
            <button
              type="button"
              aria-label={t('common.close')}
              onClick={() => setOpen(false)}
              className="-mt-2 -mr-2 flex size-11 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden className="size-5" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="self-start rounded-sm text-base text-primary underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('offer.notNow')}
          </button>
        </Sheet>
      )}
    </OfferContext.Provider>
  );
}

/**
 * The offer from 720 px (the handoff's §2): a 400 px dialog over a scrim — the title, why, *Sign in*
 * as a link, and *Create an account* beside *Not now*.
 */
function OfferDialog({
  open,
  onOpenChange,
  next,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  next: string;
}) {
  const { t } = useWeb();
  const close = () => onOpenChange(false);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-overlay/50 data-[state=open]:animate-in data-[state=open]:fade-in motion-reduce:animate-none" />
        <DialogPrimitive.Content className="fixed top-1/2 left-1/2 z-50 flex w-100 max-w-full -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-2xl bg-card p-6 text-card-foreground shadow-3 outline-none duration-(--duration-normal) data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95 motion-reduce:animate-none">
          <DialogPrimitive.Title className="text-lg font-semibold text-foreground">
            {t('offer.title')}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-sm text-muted-foreground">
            {t('offer.body')}
          </DialogPrimitive.Description>
          <Link
            href={`/sign-in${next}`}
            onClick={close}
            className="self-start rounded-sm text-sm font-medium text-primary underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('offer.signIn')}
          </Link>
          <div className="flex justify-end gap-3 pt-1">
            <Button asChild size="lg">
              <Link href={`/sign-up${next}`} onClick={close}>
                {t('offer.create')}
              </Link>
            </Button>
            <Button variant="outline" size="lg" onClick={close}>
              {t('offer.notNow')}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** The heart's hook into the offer. */
export function useAccountOffer(): { afterSave: () => void } {
  return useContext(OfferContext) ?? { afterSave: () => undefined };
}
