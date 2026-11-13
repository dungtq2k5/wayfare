'use client';

import { Input } from '@wayfare/ui/field';
import { useEffect, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import { formatDate } from '../i18n/format';
import { useConsole } from '../i18n/provider';
import { parseDay } from './day';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A day, typed as the console shows it ("30 Oct 2026", "30 thg 10, 2026"): a text field, not
 * `type="date"`, which follows the browser's locale (month first). `onChange` gets `yyyy-mm-dd`
 * once the text reads as a day, `''` when empty, else the text as typed, for the form to refuse.
 */
export function DayInput({
  value,
  onChange,
  onBlur,
  ...props
}: Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'type'> & {
  value: string;
  onChange: (day: string) => void;
}) {
  const { t, locale } = useConsole();
  const shown = (day: string) => (ISO_DAY.test(day) ? formatDate(`${day}T12:00:00`, locale) : day);
  const [text, setText] = useState(() => shown(value));
  // What this field last said; a different value came from outside (a reset), so it is shown.
  const said = useRef(value);
  useEffect(() => {
    if (value === said.current) return;
    said.current = value;
    setText(shown(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `shown` follows `locale` alone
  }, [value]);
  return (
    <Input
      {...props}
      placeholder={t('day.placeholder')}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        const typed = event.target.value.trim();
        const day = typed === '' ? '' : (parseDay(typed) ?? typed);
        said.current = day;
        onChange(day);
      }}
      onBlur={(event) => {
        // Read back as the console writes it.
        if (ISO_DAY.test(said.current)) setText(shown(said.current));
        onBlur?.(event);
      }}
    />
  );
}

/** Whether a {@link DayInput}'s value is a day. */
export const isDay = (value: string) => ISO_DAY.test(value);
