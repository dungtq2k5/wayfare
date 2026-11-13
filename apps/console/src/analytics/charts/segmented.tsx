'use client';

import { cn } from '@wayfare/ui/cn';
import type { LucideIcon } from 'lucide-react';
import { useId } from 'react';

/**
 * A few choices side by side, one chosen (the range, *Chart · Table*, a metric): native radios,
 * so arrow keys move between them and a reader hears a radio group.
 */
export function Segmented<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V | null;
  options: readonly { value: V; label: string; icon?: LucideIcon }[];
  onChange: (value: V) => void;
}) {
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex flex-wrap gap-0.5 rounded-md bg-muted p-0.5"
    >
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <label
            key={option.value}
            className={cn(
              'flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium whitespace-nowrap text-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring',
              value === option.value ? 'border-input bg-background' : 'border-transparent',
            )}
          >
            <input
              type="radio"
              name={name}
              className="sr-only"
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            {Icon === undefined ? null : <Icon aria-hidden className="size-4" />}
            {option.label}
          </label>
        );
      })}
    </div>
  );
}
