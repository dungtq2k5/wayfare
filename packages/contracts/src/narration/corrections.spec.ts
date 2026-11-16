import { describe, expect, it } from 'vitest';
import { zCorrection } from './corrections';

describe('the served shapes', () => {
  it('refuse a language outside the served list', () => {
    const issues = zCorrection.safeParse({ lang: 'xx' }).error?.issues ?? [];
    expect(issues.some((issue) => issue.path[0] === 'lang')).toBe(true);
  });
});
