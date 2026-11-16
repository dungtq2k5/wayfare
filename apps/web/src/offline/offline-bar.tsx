'use client';

import { toast } from '@wayfare/ui/toaster';
import { WifiOff, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useWeb } from '../i18n/provider';

/**
 * WO2: one dismissable bar under the header per offline spell — what works and what waits — and a
 * toast once back online.
 */
export function OfflineBar() {
  const { t } = useWeb();
  const [offline, setOffline] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const wasOffline = useRef(false);
  useEffect(() => {
    const update = () => {
      const now = !navigator.onLine;
      setOffline(now);
      if (now) setDismissed(false);
      if (!now && wasOffline.current) toast.success(t('wo.backOnline'));
      wasOffline.current = now;
    };
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, [t]);
  if (!offline || dismissed) return null;
  return (
    <div
      role="status"
      className="flex items-start gap-2 bg-muted px-4 py-2 text-sm text-foreground tablet:px-6"
    >
      <WifiOff aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1">{t('wo.offline')}</p>
      <button
        type="button"
        aria-label={t('wo.dismiss')}
        onClick={() => setDismissed(true)}
        className="-my-2 flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X aria-hidden className="size-5" />
      </button>
    </div>
  );
}
