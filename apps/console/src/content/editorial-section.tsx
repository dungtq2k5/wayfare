'use client';

import { adminPlacesUpdateEditorial } from '@wayfare/api-client';
import {
  MAX_TRIGGER_RADIUS_M,
  MIN_TRIGGER_RADIUS_M,
  NARRATION_PRIORITY_MAX,
  NARRATION_PRIORITY_MIN,
  zUpdateEditorialInput,
} from '@wayfare/contracts';
import { Button } from '@wayfare/ui/button';
import { Field, FormAlert, Input } from '@wayfare/ui/field';
import { toast } from '@wayfare/ui/toaster';
import { useState } from 'react';
import { errorText } from '../client/errors';
import { validateForm } from '../forms/field-errors';
import type { FieldErrors } from '../forms/field-errors';
import { useConsole } from '../i18n/provider';
import { Facts, Section } from './place-sections';
import { radiusComparison } from './words';

/** A number field with its slider: both say the same value. */
export function SliderField({
  label,
  help,
  error,
  value,
  min,
  max,
  onChange,
  required = true,
}: {
  label: string;
  help: string;
  error?: string | undefined;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  required?: boolean;
}) {
  return (
    <Field label={label} help={help} error={error} required={required}>
      {(control) => (
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={min}
            max={max}
            value={value}
            aria-hidden
            tabIndex={-1}
            onChange={(event) => onChange(Number(event.target.value))}
            className="h-2 flex-1 accent-primary"
          />
          <Input
            {...control}
            type="number"
            min={min}
            max={max}
            value={Number.isNaN(value) ? '' : value}
            onChange={(event) => onChange(event.target.valueAsNumber)}
            className="w-20 text-right"
          />
        </div>
      )}
    </Field>
  );
}

/**
 * The editorial values (L6): edited in place and saved on their own — the Place never leaves
 * *Active* — with the radius said against the street. Owners never see them.
 */
export function EditorialSection({
  placeId,
  radiusM,
  priority,
  canEdit,
  onDraftRadius,
  onSaved,
}: {
  placeId: string;
  radiusM: number;
  priority: number;
  canEdit: boolean;
  /** The radius being edited, for the map's circle; `null` when not editing. */
  onDraftRadius: (radius: number | null) => void;
  onSaved: () => void;
}) {
  const translator = useConsole();
  const { t } = translator;
  const [editing, setEditing] = useState(false);
  const [radius, setRadius] = useState(radiusM);
  const [prio, setPrio] = useState(priority);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rangeMessages = {
    triggerRadiusM: () => t('editorial.radiusRange'),
    narrationPriority: () => t('editorial.priorityRange'),
  };
  const save = () => {
    const checked = validateForm(
      zUpdateEditorialInput,
      { triggerRadiusM: radius, narrationPriority: prio },
      translator,
      rangeMessages,
    );
    setErrors(checked.ok ? {} : checked.errors);
    if (!checked.ok) return;
    setBusy(true);
    setAlert(null);
    adminPlacesUpdateEditorial(placeId, checked.data).then(
      () => {
        setBusy(false);
        setEditing(false);
        onDraftRadius(null);
        toast.success(t('editorial.saved'));
        onSaved();
      },
      (error: unknown) => {
        setBusy(false);
        setAlert(errorText(error, translator));
      },
    );
  };

  return (
    <Section id="editorial" title={t('place.editorial')}>
      {editing ? (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          {alert === null ? null : <FormAlert>{alert}</FormAlert>}
          <SliderField
            label={t('editorial.radius')}
            help={t('editorial.radiusHelp', { m: radius, comparison: t(radiusComparison(radius)) })}
            error={errors.triggerRadiusM}
            value={radius}
            min={MIN_TRIGGER_RADIUS_M}
            max={MAX_TRIGGER_RADIUS_M}
            onChange={(value) => {
              setRadius(value);
              if (!Number.isNaN(value)) onDraftRadius(value);
            }}
          />
          <SliderField
            label={t('editorial.priority')}
            help={t('editorial.priorityHelp')}
            error={errors.narrationPriority}
            value={prio}
            min={NARRATION_PRIORITY_MIN}
            max={NARRATION_PRIORITY_MAX}
            onChange={setPrio}
          />
          <p className="text-xs text-muted-foreground">{t('editorial.never')}</p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEditing(false);
                setRadius(radiusM);
                setPrio(priority);
                setErrors({});
                onDraftRadius(null);
              }}
            >
              {t('action.cancel')}
            </Button>
            <Button type="submit" busy={busy ? t('action.saving') : undefined}>
              {t('editorial.save')}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <Facts
            rows={[
              [
                t('editorial.radius'),
                t('place.editorialRadius', {
                  m: radiusM,
                  comparison: t(radiusComparison(radiusM)),
                }),
              ],
              [t('editorial.priority'), t('place.editorialPriority', { p: priority })],
            ]}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{t('place.editorialOnly')}</p>
            {canEdit ? (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                {t('place.edit')}
              </Button>
            ) : null}
          </div>
        </>
      )}
    </Section>
  );
}
