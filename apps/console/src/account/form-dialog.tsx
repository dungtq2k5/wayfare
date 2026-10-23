'use client';

import { Button } from '@wayfare/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@wayfare/ui/dialog';
import { FormAlert } from '@wayfare/ui/field';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useConsole } from '../i18n/provider';

/**
 * One of the account's small forms in a dialog: its fields, the failure said once above them, and
 * the busy *Save* (C12b). `onSubmit` returns false to keep the dialog open with its own errors.
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  submit,
  alert,
  onSubmit,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  submit: string;
  alert: string | null;
  onSubmit: () => Promise<boolean>;
  children: ReactNode;
}) {
  const { t } = useConsole();
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('action.close')}>
        <DialogHeader title={title} {...(description === undefined ? {} : { description })} />
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            void onSubmit().then((done) => {
              setBusy(false);
              if (done) onOpenChange(false);
            });
          }}
        >
          {alert === null ? null : <FormAlert>{alert}</FormAlert>}
          {children}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('action.cancel')}
            </Button>
            <Button type="submit" busy={busy ? t('action.saving') : undefined}>
              {submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
