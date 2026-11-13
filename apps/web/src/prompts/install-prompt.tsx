'use client';

import { Button } from '@wayfare/ui/button';
import { Download, Footprints } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { readKv, writeKv } from '../client/db';
import { PLAY_STORE_URL } from '../env';
import { useWeb } from '../i18n/provider';
import { isAndroid, isIosSafari } from '../places/intent';
import { usePlayer } from '../player/use-player';
import { Sheet } from '../ui/sheet';
import { ANDROID_REST_MS, offerAndroidApp, offerHomeScreen } from './rules';

const REST_KEY = 'androidAppRestUntil';
const HOME_KEY = 'homeScreenShown';

/** A visit's page views, in the tab's own storage: a new tab is a new visit. */
function countPageView(): number {
  try {
    const views = Number(sessionStorage.getItem('wf_web_views') ?? '0') + 1;
    sessionStorage.setItem('wf_web_views', String(views));
    return views;
  } catch {
    return 1;
  }
}

/** iPhone Safari's own Home Screen steps (WO1b): once ever; also from Settings. */
export function HomeScreenSteps({ open, onDone }: { open: boolean; onDone: () => void }) {
  const { t } = useWeb();
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? undefined : onDone())}
      title={t('wo.iosTitle')}
    >
      <p className="text-sm text-muted-foreground">{t('wo.iosBody')}</p>
      <ol className="flex flex-col gap-2">
        {[t('wo.iosStep1'), t('wo.iosStep2'), t('wo.iosStep3')].map((step, index) => (
          <li key={step} className="flex items-center gap-3 text-base text-foreground">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm text-accent-foreground">
              {index + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
      <Button variant="outline" size="lg" onClick={onDone}>
        {t('wo.gotIt')}
      </Button>
    </Sheet>
  );
}

/**
 * Getting the app (WO1, Android) and keeping the web app (WO1b, iPhone): a bottom sheet each, by
 * K13's rules, decided per browser.
 */
export function InstallPrompt() {
  const { t } = useWeb();
  const pathname = usePathname();
  const player = usePlayer();
  const [which, setWhich] = useState<'android' | 'ios' | null>(null);
  const played = useRef(new Set<string>());
  if (player.phase === 'playing' && player.track !== null) played.current.add(player.track.code);

  useEffect(() => {
    const views = countPageView();
    const ua = navigator.userAgent;
    const onPlace = pathname.startsWith('/p/');
    const code = onPlace ? pathname.slice(3).replaceAll('-', '').toUpperCase() : '';
    void (async () => {
      if (
        offerAndroidApp({
          android: isAndroid(ua),
          pageViews: views,
          onPlacePage: onPlace,
          storyPlayed: played.current.has(code),
          restUntil: await readKv(REST_KEY, 0),
          now: Date.now(),
        })
      ) {
        setWhich('android');
        return;
      }
      const standalone = matchMedia('(display-mode: standalone)').matches;
      if (
        offerHomeScreen({
          iosSafari: isIosSafari(ua),
          standalone,
          shownBefore: await readKv(HOME_KEY, false),
        })
      ) {
        await writeKv(HOME_KEY, true);
        setWhich('ios');
      }
    })();
  }, [pathname]);

  const rest = () => {
    setWhich(null);
    void writeKv(REST_KEY, Date.now() + ANDROID_REST_MS);
  };

  return (
    <>
      <Sheet
        open={which === 'android'}
        onOpenChange={(next) => (next ? undefined : rest())}
        title={t('wo.androidTitle')}
        titleHidden
        focusSheet
      >
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <Footprints aria-hidden className="size-6" />
          </span>
          <p className="text-lg font-semibold text-foreground">{t('wo.androidTitle')}</p>
        </div>
        <p className="text-sm text-muted-foreground">{t('wo.androidBody')}</p>
        <Button asChild size="lg">
          <a href={PLAY_STORE_URL} onClick={rest}>
            <Download aria-hidden />
            {t('wo.getApp')}
          </a>
        </Button>
        <Button variant="ghost" size="lg" onClick={rest}>
          {t('wo.notNow')}
        </Button>
      </Sheet>
      <HomeScreenSteps open={which === 'ios'} onDone={() => setWhich(null)} />
    </>
  );
}
