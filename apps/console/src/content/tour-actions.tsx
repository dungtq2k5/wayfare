'use client';

import { ApiError, adminToursDeactivate, adminToursRemove } from '@wayfare/api-client';
import { ConfirmDialog, DestructiveDialog } from '@wayfare/ui/dialogs';
import { toast } from '@wayfare/ui/toaster';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { errorText } from '../client/errors';
import { useConsole } from '../i18n/provider';

/** Deactivate (TA5a): what tourists lose, and that it comes back. No reason is asked (api §3.6). */
export function TourDeactivateDialog({
  tour,
  open,
  onOpenChange,
  onChanged,
}: {
  tour: { readonly id: string; readonly titleVi: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const translator = useConsole();
  const { t } = translator;
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setAlert(null);
        onOpenChange(next);
      }}
      title={t('tour.deactivateTitle', { title: tour.titleVi })}
      description={t('tour.deactivateBody')}
      confirm={t('tour.deactivate')}
      busy={busy ? t('tour.deactivate') : undefined}
      labels={{ cancel: t('action.cancel'), close: t('action.close') }}
      alert={alert}
      onConfirm={() => {
        setBusy(true);
        adminToursDeactivate(tour.id).then(
          () => {
            setBusy(false);
            onOpenChange(false);
            onChanged();
            toast.success(t('tour.deactivated', { title: tour.titleVi }));
          },
          (error: unknown) => {
            setBusy(false);
            setAlert(errorText(error, translator));
          },
        );
      }}
    />
  );
}

/** Delete (TA5b): the title typed to confirm; its Places aren't touched; restorable, no *Undo*. */
export function TourDeleteDialog({
  tour,
  open,
  onOpenChange,
}: {
  tour: { readonly id: string; readonly titleVi: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const translator = useConsole();
  const { t, tDynamic } = translator;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  return (
    <DestructiveDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setAlert(null);
        onOpenChange(next);
      }}
      title={t('tour.deleteTitle', { title: tour.titleVi })}
      description={t('tour.deleteBody')}
      confirm={t('tour.delete')}
      busy={busy ? t('tour.delete') : undefined}
      labels={{ cancel: t('action.cancel'), close: t('action.close') }}
      alert={alert ?? undefined}
      name={tour.titleVi}
      typeLabel={t('tour.typeToConfirm', { title: tour.titleVi })}
      onConfirm={() => {
        setBusy(true);
        adminToursRemove(tour.id).then(
          () => {
            toast.success(t('tour.deleted', { title: tour.titleVi }));
            router.push('/tours');
          },
          (error: unknown) => {
            setBusy(false);
            setAlert(
              error instanceof ApiError
                ? tDynamic(`error.${error.code}`, undefined, errorText(error, translator))
                : errorText(error, translator),
            );
          },
        );
      }}
    />
  );
}
