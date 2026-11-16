'use client';

import { MAX_DECISION_NOTE_LENGTH } from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { ConfirmDialog, DestructiveDialog, ReasonDialog } from '@wayfare/ui/dialogs';
import { PageHeader } from '@wayfare/ui/list';
import { Card, CardTitle, StatusBadge } from '@wayfare/ui/surfaces';
import type { StatusTone } from '@wayfare/ui/surfaces';
import { toast } from '@wayfare/ui/toaster';
import { useState } from 'react';
import { useConsole } from '../i18n/provider';
import { SAMPLE_PLACES } from './sample';

const place = SAMPLE_PLACES[0]!;
/** A decision note's least length (P4c). */
const MIN_NOTE_LENGTH = 10;

/**
 * P2, P4 and P5: the detail page with its actions; the three dialogs (a confirmation, a destructive
 * one with the typed name, one with a reason); the toasts. Unpublish has a plain inverse that nobody
 * else saw yet, so its success carries *Undo* (K17).
 */
export function DetailDemo({
  status,
  onStatus,
}: {
  status: StatusTone;
  onStatus: (status: StatusTone) => void;
}) {
  const { t } = useConsole();
  const [open, setOpen] = useState<'unpublish' | 'delete' | 'reject' | null>(null);
  const labels = { cancel: t('action.cancel'), close: t('action.close') };
  const facts: [string, string][] = [
    [t('detail.code'), place.code],
    [t('places.area'), place.area],
    [t('places.category'), place.category],
    [t('detail.owner'), place.owner],
    [t('detail.plays'), '1 284'],
  ];

  return (
    <section aria-labelledby="p2" className="flex flex-col gap-4">
      <PageHeader
        title={place.name}
        breadcrumb={<StatusBadge tone={status}>{t(`status.${status}`)}</StatusBadge>}
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={status !== 'active'}
              onClick={() => setOpen('unpublish')}
            >
              {t('detail.unpublish')}
            </Button>
            <Button>{t('detail.edit')}</Button>
          </div>
        }
      />
      <h2 id="p2" className="sr-only">
        P2
      </h2>
      <Card className="flex max-w-2xl flex-col gap-2">
        <CardTitle>{t('detail.facts')}</CardTitle>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 pt-2 text-sm sm:grid-cols-2">
          {facts.map(([term, value]) => (
            <div key={term} className="flex flex-col gap-1">
              <dt className="text-muted-foreground">{term}</dt>
              <dd className="text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-foreground">{t('patterns.dialogs')}</h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setOpen('delete')}>
            {t('patterns.delete')}
          </Button>
          <Button variant="outline" onClick={() => setOpen('reject')}>
            {t('patterns.reject')}
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              toast.error(t('toast.saveFailed'), {
                description: t('toast.failedBody', { id: 'req_01JBX7Q2M4N8' }),
                duration: Infinity,
                action: { label: t('action.retry'), onClick: () => undefined },
              })
            }
          >
            {t('toast.saveFailed')}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={open === 'unpublish'}
        onOpenChange={(next) => !next && setOpen(null)}
        title={t('dialog.unpublishTitle', { name: place.name })}
        description={t('dialog.unpublishBody')}
        confirm={t('dialog.unpublish')}
        labels={labels}
        onConfirm={() => {
          setOpen(null);
          onStatus('inactive');
          toast.success(t('toast.unpublished'), {
            description: t('toast.unpublishedBody', { name: place.name }),
            action: {
              label: t('action.undo'),
              onClick: () => {
                onStatus('active');
                toast.success(t('toast.published'));
              },
            },
          });
        }}
      />
      <DestructiveDialog
        open={open === 'delete'}
        onOpenChange={(next) => !next && setOpen(null)}
        title={t('dialog.deleteTitle', { name: place.name })}
        description={t('dialog.deleteBody')}
        confirm={t('dialog.delete')}
        labels={labels}
        name={place.name}
        typeLabel={t('dialog.typeName', { name: place.name })}
        onConfirm={() => setOpen(null)}
      />
      <ReasonDialog
        open={open === 'reject'}
        onOpenChange={(next) => !next && setOpen(null)}
        title={t('dialog.rejectTitle')}
        description={t('dialog.rejectBody')}
        confirm={t('dialog.reject')}
        labels={labels}
        noteLabel={t('dialog.note')}
        placeholder={t('pattern.reasonPlaceholder')}
        noteHelp={t('dialog.noteHelp', { owner: place.owner })}
        minLength={MIN_NOTE_LENGTH}
        maxLength={MAX_DECISION_NOTE_LENGTH}
        onConfirm={() => setOpen(null)}
      />
    </section>
  );
}
