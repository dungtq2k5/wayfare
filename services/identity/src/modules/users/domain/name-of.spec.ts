import { describe, expect, it } from 'vitest';
import { nameOf } from './name-of';

describe('nameOf', () => {
  const row = { fullName: 'Lan Pham', email: 'lan@example.com', erasedAt: null };

  it('is the full name, else the email', () => {
    expect(nameOf(row)).toEqual({ name: 'Lan Pham' });
    expect(nameOf({ ...row, fullName: null })).toEqual({ name: 'lan@example.com' });
  });

  it('is absent for an erased account', () => {
    expect(nameOf({ ...row, erasedAt: new Date() })).toEqual({});
  });
});
