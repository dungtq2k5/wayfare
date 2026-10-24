'use client';

import {
  ApiError,
  adminPlacesActivate,
  adminPlacesDeactivate,
  adminPlacesDelete,
} from '@wayfare/api-client';
import { MAX_ADMIN_REASON_LENGTH } from '@wayfare/contracts';
import { DestructiveDialog, ReasonDialog } from '@wayfare/ui/dialogs';
import { toast } from '@wayfare/ui/toaster';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { errorText } from '../client/errors';
import { useConsole } from '../i18n/provider';
import type { PlaceDetail } from './place-types';
import { hasUndo } from './words';

/** The owner's name for the copy: their name, else their address, else "its owner". */
export const ownerName = (place: PlaceDetail, fallback: string): string =>
  place.owner?.name ?? place.owner?.email ?? fallback;

/**
 * Deactivate (L8a, L8e): a reason is required. An Editorial Place's toast carries *Undo* — nobody
 * outside the staff heard of it; a Venue's owner is told at once, so its dialog says so, its button
 * names them, and its toast has no action (K7).
 */
export function DeactivateDialog({
  place,
  open,
  onOpenChange,
  onChanged,
}: {
  place: PlaceDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const translator = useConsole();
  const { t } = translator;
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const venue = place.kind === 'VENUE';
  const owner = ownerName(place, t('place.aVenueOwner'));
  const kind = place.kind;

  const undo = () =>
    void adminPlacesActivate(place.id).then(onChanged, (error: unknown) =>
      toast.error(errorText(error, translator), { duration: Infinity }),
    );

  return (
    <ReasonDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setAlert(null);
        onOpenChange(next);
      }}
      title={t('deactivate.title', { name: place.nameVi })}
      description={venue ? t('deactivate.bodyVenue', { owner }) : t('deactivate.bodyEditorial')}
      confirm={venue ? t('deactivate.confirmVenue', { owner }) : t('deactivate.confirm')}
      busy={busy ? t('deactivate.confirm') : undefined}
      labels={{ cancel: t('action.cancel'), close: t('action.close') }}
      alert={alert}
      noteLabel={t('deactivate.reason')}
      noteHelp={venue ? t('deactivate.reasonHelpVenue', { owner }) : t('deactivate.reasonHelp')}
      minLength={1}
      maxLength={MAX_ADMIN_REASON_LENGTH}
      onConfirm={(reason) => {
        setBusy(true);
        adminPlacesDeactivate(place.id, { reason }).then(
          () => {
            setBusy(false);
            onOpenChange(false);
            onChanged();
            if (hasUndo('deactivate', kind)) {
              toast.success(t('deactivate.done'), {
                action: { label: t('action.undo'), onClick: undo },
              });
            } else {
              toast.success(t('deactivate.doneVenue', { name: place.nameVi }), {
                description: t('deactivate.toldVenue', { owner }),
              });
            }
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

/**
 * Delete (L8b): the name typed exactly; a refusal is said inside the dialog, which stays open. No
 * *Undo* afterwards (K9): the stickers stop at once, and *Restore* lives under *Include deleted*.
 */
export function DeleteDialog({
  place,
  open,
  onOpenChange,
}: {
  place: PlaceDetail;
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
      title={t('delete.title', { name: place.nameVi })}
      description={t('delete.body')}
      confirm={t('delete.confirm')}
      busy={busy ? t('delete.confirm') : undefined}
      labels={{ cancel: t('action.cancel'), close: t('action.close') }}
      alert={
        alert === null ? undefined : (
          <>
            <strong className="block">{t('delete.refused')}</strong>
            {alert}
          </>
        )
      }
      name={place.nameVi}
      typeLabel={t('delete.type', { name: place.nameVi })}
      onConfirm={() => {
        setBusy(true);
        adminPlacesDelete(place.id).then(
          () => {
            toast.success(t('delete.done'), {
              description: t('delete.doneBody', { name: place.nameVi }),
            });
            router.push('/places');
          },
          (error: unknown) => {
            setBusy(false);
            setAlert(
              error instanceof ApiError && error.code === 'UPSTREAM_UNAVAILABLE'
                ? t('delete.billingDown')
                : error instanceof ApiError
                  ? tDynamic(`error.${error.code}`, undefined, errorText(error, translator))
                  : errorText(error, translator),
            );
          },
        );
      }}
    />
  );
}
