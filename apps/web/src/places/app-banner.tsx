import { Button } from '@wayfare/ui/button';
import { Smartphone } from 'lucide-react';
import type { Translator } from '../i18n/messages';
import { appIntent } from './intent';

/** The thin Android bar (WQ1): the app tells stories as you walk · *Open in the app*. */
export function AppBanner({ code, host, t }: { code: string; host: string; t: Translator['t'] }) {
  return (
    <div className="flex items-center gap-3 bg-accent px-4 py-2 text-accent-foreground tablet:px-6">
      <Smartphone aria-hidden className="size-5 shrink-0" />
      <p className="min-w-0 flex-1 text-sm">{t('app.bar')}</p>
      <Button asChild variant="outline" size="lg" className="bg-background">
        <a href={appIntent(code, host)}>{t('app.open')}</a>
      </Button>
    </div>
  );
}
