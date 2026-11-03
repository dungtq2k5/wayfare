'use client';

import { Button } from '@wayfare/ui/button';
import { Languages } from 'lucide-react';
import { useEffect } from 'react';
import { setPageCookie } from '../client/cookies';
import { LANGUAGE_COOKIE } from '../i18n/language';
import { useWeb } from '../i18n/provider';
import { useLanguagePicker } from './language-picker-state';

/**
 * WQ6: none of the browser's languages is one Wayfare speaks, so the page is in English and says
 * so, once. English is kept as this browser's choice the moment the bar shows: the next page has
 * no bar; *Choose* opens the picker.
 */
export function LanguageBar() {
  const { t } = useWeb();
  const picker = useLanguagePicker();
  useEffect(() => setPageCookie(LANGUAGE_COOKIE, 'en'), []);
  return (
    <div
      role="status"
      className="flex items-center gap-2 bg-info px-4 py-2 text-sm text-info-foreground tablet:px-6"
    >
      <Languages aria-hidden className="size-5 shrink-0" />
      <p className="min-w-0 flex-1">{t('lang.unsupported')}</p>
      <Button
        variant="outline"
        size="lg"
        className="bg-background"
        onClick={() => picker.setOpen(true)}
      >
        {t('lang.choose')}
      </Button>
    </div>
  );
}
