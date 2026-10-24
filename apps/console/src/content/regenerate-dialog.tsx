'use client';

import { adminNarrationCreate } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@wayfare/ui/dialog';
import { FormAlert } from '@wayfare/ui/field';
import { toast } from '@wayfare/ui/toaster';
import { useState } from 'react';
import { errorText } from '../client/errors';
import { autonym } from '../i18n/language-names';
import { useConsole } from '../i18n/provider';
import type { LocalizationState } from './words';

/** Whether a language needs redoing: its text or audio out of date, or not made. */
export const outOfDate = (row: LocalizationState): boolean =>
  !row.textReady || row.stale || row.audioStale || row.audioStatus === 'FAILED';

/**
 * Regenerate (J4): the languages, the out-of-date ones ticked, text and audio (the default) or text
 * only. It replaces any job still running for the Place; tourists keep the current audio meanwhile.
 */
export function RegenerateDialog({
  open,
  onOpenChange,
  placeId,
  name,
  localizations,
  onStarted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placeId: string;
  name: string;
  localizations: readonly LocalizationState[];
  onStarted: (jobId: string) => void;
}) {
  const translator = useConsole();
  const { t } = translator;
  const rows = localizations.filter((row) => row.lang !== 'vi');
  const [langs, setLangs] = useState<Set<string>>(
    () => new Set(rows.filter(outOfDate).map((row) => row.lang)),
  );
  const [includeAudio, setIncludeAudio] = useState(true);
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = () => {
    if (busy || langs.size === 0) return;
    setBusy(true);
    setAlert(null);
    adminNarrationCreate({
      targetType: 'PLACE',
      targetId: placeId,
      langs: [...langs],
      includeAudio,
    }).then(
      ({ data }) => {
        setBusy(false);
        onOpenChange(false);
        toast.success(t('regen.started'));
        onStarted(data.job.id);
      },
      (error: unknown) => {
        setBusy(false);
        setAlert(errorText(error, translator));
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('action.close')}>
        <DialogHeader title={t('regen.title')} description={name} />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-foreground">
            {t('regen.languages')}
          </legend>
          {rows.map((row) => (
            <label key={row.lang} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={langs.has(row.lang)}
                onChange={(event) =>
                  setLangs((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(row.lang);
                    else next.delete(row.lang);
                    return next;
                  })
                }
              />
              <span lang={row.lang}>{autonym(row.lang)}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-foreground">{t('regen.make')}</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="regen-make"
              className="size-4 accent-primary"
              checked={includeAudio}
              onChange={() => setIncludeAudio(true)}
            />
            {t('regen.textAndAudio')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="regen-make"
              className="size-4 accent-primary"
              checked={!includeAudio}
              onChange={() => setIncludeAudio(false)}
            />
            {t('regen.textOnly')}
          </label>
        </fieldset>
        <p className="text-xs text-muted-foreground">{t('regen.note')}</p>
        {alert === null ? null : <FormAlert>{alert}</FormAlert>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('action.cancel')}
          </Button>
          <Button
            busy={busy ? t('regen.confirm', { count: langs.size }) : undefined}
            disabled={langs.size === 0}
            onClick={start}
          >
            {t('regen.confirm', { count: langs.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
