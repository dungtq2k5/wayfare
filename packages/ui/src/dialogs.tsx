'use client';

import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from './button';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from './dialog';
import { Field, FormAlert, Input, Textarea } from './field';

interface DialogLabels {
  cancel: string;
  close: string;
}

interface BaseProps {
  /** A refusal said inside the dialog, which stays open (K8, K11). */
  alert?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirm: string;
  busy?: string | undefined;
  labels: DialogLabels;
  /** The button's strength: destructive only for what can't be undone. */
  tone?: 'primary' | 'destructive';
}

/** A confirmation (P4a): the action named in the title and on its button, *Cancel* first. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirm,
  busy,
  labels,
  alert,
  tone = 'primary',
  onConfirm,
}: BaseProps & { onConfirm: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={labels.close}>
        <DialogHeader title={title} description={description} />
        {alert === undefined || alert === null ? null : <FormAlert>{alert}</FormAlert>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button
            variant={tone === 'destructive' ? 'destructive' : 'default'}
            busy={busy}
            onClick={onConfirm}
          >
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A destructive, irreversible confirmation (P4b): the name typed exactly turns the button on. */
export function DestructiveDialog({
  open,
  onOpenChange,
  title,
  description,
  confirm,
  busy,
  labels,
  alert,
  name,
  typeLabel,
  onConfirm,
}: BaseProps & { name: string; typeLabel: string; onConfirm: () => void }) {
  const [typed, setTyped] = useState('');
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTyped('');
        onOpenChange(next);
      }}
    >
      <DialogContent closeLabel={labels.close}>
        <DialogHeader title={title} description={description} />
        <Field label={typeLabel}>
          {(control) => (
            <Input
              {...control}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
            />
          )}
        </Field>
        {alert === undefined || alert === null ? null : <FormAlert>{alert}</FormAlert>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button variant="destructive" busy={busy} disabled={typed !== name} onClick={onConfirm}>
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A decision with a reason (P4c): the note is required, and the button stays off while short. */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirm,
  busy,
  labels,
  alert,
  noteLabel,
  noteHelp,
  minLength,
  maxLength,
  tone = 'destructive',
  onConfirm,
}: BaseProps & {
  noteLabel: string;
  noteHelp: string;
  minLength: number;
  maxLength: number;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState('');
  const counterId = useId();
  const length = note.trim().length;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setNote('');
        onOpenChange(next);
      }}
    >
      <DialogContent closeLabel={labels.close}>
        <DialogHeader title={title} description={description} />
        <Field label={noteLabel} required help={noteHelp}>
          {(control) => (
            <>
              <Textarea
                {...control}
                value={note}
                maxLength={maxLength}
                onChange={(event) => setNote(event.target.value)}
              />
              <p
                id={counterId}
                aria-live="polite"
                className="text-right text-xs text-muted-foreground"
              >
                {length} / {maxLength}
              </p>
            </>
          )}
        </Field>
        {alert === undefined || alert === null ? null : <FormAlert>{alert}</FormAlert>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button
            variant={tone === 'destructive' ? 'destructive' : 'default'}
            busy={busy}
            disabled={length < minLength}
            onClick={() => onConfirm(note.trim())}
          >
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Leaving with changes (P3b): asked once, *Stay* the default. */
export function LeaveDialog({
  open,
  onOpenChange,
  title,
  description,
  stay,
  leave,
  closeLabel,
  onLeave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  stay: string;
  leave: string;
  closeLabel: string;
  onLeave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={closeLabel}>
        <DialogHeader title={title} description={description} />
        <DialogFooter>
          <Button variant="outline" onClick={onLeave}>
            {leave}
          </Button>
          <Button autoFocus onClick={() => onOpenChange(false)}>
            {stay}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
