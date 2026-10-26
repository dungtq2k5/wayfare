'use client';

import { MAX_DECISION_NOTE_LENGTH } from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@wayfare/ui/dialog';
import { Field, FormAlert, Textarea } from '@wayfare/ui/field';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useConsole } from '../i18n/provider';

/** The handoff's least for a required note to the owner ("At least 10 characters"). */
export const MIN_REQUIRED_NOTE = 10;

export interface DecisionNotes {
  decisionNote?: string;
  internalNote?: string;
}

/**
 * Approve or reject (S4, S5, R4): what happens next, a note to the owner — required on a reject —
 * and an internal note. A refusal is said inside, and the dialog stays open so the reviewer can
 * cancel and reject instead (K11). The button is off while busy, so a second press sends nothing.
 */
export function DecisionDialog({
  open,
  onOpenChange,
  title,
  children,
  confirm,
  reject = false,
  note,
  busy,
  alert,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  confirm: string;
  reject?: boolean;
  note: { label: string; help: string };
  busy: boolean;
  alert: ReactNode;
  onConfirm: (notes: DecisionNotes) => void;
}) {
  const { t } = useConsole();
  const [decisionNote, setDecisionNote] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const short = reject && decisionNote.trim().length < MIN_REQUIRED_NOTE;
  const optional = (text: string) => (text.trim() === '' ? undefined : text.trim());
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setDecisionNote('');
          setInternalNote('');
        }
        onOpenChange(next);
      }}
    >
      <DialogContent closeLabel={t('action.close')}>
        <DialogHeader title={title} />
        <div className="flex flex-col gap-2 rounded-md bg-muted p-3 text-sm text-muted-foreground">
          {children}
        </div>
        <Field label={note.label} required={reject} help={note.help}>
          {(control) => (
            <>
              <Textarea
                {...control}
                rows={3}
                maxLength={MAX_DECISION_NOTE_LENGTH}
                value={decisionNote}
                onChange={(event) => setDecisionNote(event.target.value)}
              />
              <p aria-live="polite" className="text-right text-xs text-muted-foreground">
                {decisionNote.trim().length} / {MAX_DECISION_NOTE_LENGTH}
              </p>
            </>
          )}
        </Field>
        <Field label={t('approve.noteInternal')} help={t('approve.noteInternalHelp')}>
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              maxLength={MAX_DECISION_NOTE_LENGTH}
              value={internalNote}
              onChange={(event) => setInternalNote(event.target.value)}
            />
          )}
        </Field>
        {alert === null || alert === undefined ? null : <FormAlert>{alert}</FormAlert>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('action.cancel')}
          </Button>
          <Button
            variant={reject ? 'destructive' : 'default'}
            busy={busy ? t('action.saving') : undefined}
            disabled={short}
            onClick={() =>
              onConfirm({
                ...(optional(decisionNote) === undefined
                  ? {}
                  : { decisionNote: optional(decisionNote) }),
                ...(optional(internalNote) === undefined
                  ? {}
                  : { internalNote: optional(internalNote) }),
              })
            }
          >
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
