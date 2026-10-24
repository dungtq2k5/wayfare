'use client';

import { FilterButton } from '@wayfare/ui/list';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@wayfare/ui/menu';

const ALL = '__all__';

/** A list's filter (P1): its name and value ("All" when unset), opening a menu of values. */
export function Filter({
  name,
  value,
  allLabel,
  options,
  onChange,
}: {
  name: string;
  value: string | null;
  allLabel: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string | null) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <FilterButton
          name={name}
          value={options.find((option) => option.value === value)?.label ?? allLabel}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuRadioGroup
          value={value ?? ALL}
          onValueChange={(next) => onChange(next === ALL ? null : next)}
        >
          <DropdownMenuRadioItem value={ALL}>{allLabel}</DropdownMenuRadioItem>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
