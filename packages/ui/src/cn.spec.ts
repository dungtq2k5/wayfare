import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('class names', () => {
  it('joins them, a later utility winning over an earlier one of its kind, falsy ones dropped', () => {
    const hidden = false;
    expect(cn('p-2 text-sm', hidden && 'hidden', 'p-4')).toBe('text-sm p-4');
  });
});
