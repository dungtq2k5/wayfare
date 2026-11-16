'use client';

import { Button } from '@wayfare/ui/button';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useWeb } from '../i18n/provider';
import { openedPlaces } from '../places/opened';

/** WO2b: offline, a page never opened on this browser — the ones that were, and *Try again*. */
export function NotSaved() {
  const { t, locale } = useWeb();
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    void openedPlaces().then((places) => setNames(places.slice(0, 3).map((place) => place.name)));
  }, []);
  const list = new Intl.ListFormat(locale, { type: 'conjunction' }).format(names);
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 px-4 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Search aria-hidden className="size-6" />
      </span>
      <h1 className="text-lg font-semibold text-foreground">{t('wo.notSavedTitle')}</h1>
      <p className="text-sm text-muted-foreground">
        {names.length === 0 ? t('wo.notSavedNone') : t('wo.notSavedBody', { places: list })}
      </p>
      <Button size="lg" onClick={() => window.location.reload()}>
        {t('common.tryAgain')}
      </Button>
    </div>
  );
}
