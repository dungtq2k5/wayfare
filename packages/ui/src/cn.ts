import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Joins class names, the later winning over an earlier one of the same utility. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
