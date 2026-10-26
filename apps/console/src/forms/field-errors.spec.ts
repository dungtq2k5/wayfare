import { loginBodySchema, resetPasswordBodySchema } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTranslator } from '../i18n/messages';
import { errorCount, passwordShort, serverFieldErrors, validateForm } from './field-errors';

const en = createTranslator('en');
const vi = createTranslator('vi');

describe('field errors (K13)', () => {
  it('give the handoff’s sentences with the schema’s own numbers', () => {
    const description = z.object({ description: z.string().trim().min(40).max(2000) });
    const short = validateForm(description, { description: 'Phở bò since 1968.' }, en);
    expect(short).toEqual({
      ok: false,
      errors: { description: 'Write at least 40 characters (now 18).' },
    });
    const long = validateForm(description, { description: 'x'.repeat(2001) }, en);
    expect(long.ok ? null : long.errors.description).toBe(
      'Keep it under 2000 characters (now 2001).',
    );
    // An empty field says what to do with it; a field with no sentence of its own, the general one.
    expect(validateForm(description, { description: '  ' }, vi)).toEqual({
      ok: false,
      errors: { description: 'Hãy viết phần mô tả.' },
    });
    const note = z.object({ note: z.string().trim().min(1) });
    expect(validateForm(note, { note: '' }, en)).toEqual({
      ok: false,
      errors: { note: 'This is required.' },
    });
  });

  it('read the contracts’ sign-in and reset schemas', () => {
    expect(validateForm(loginBodySchema, { email: 'nope', password: 'x' }, en)).toEqual({
      ok: false,
      errors: { email: 'Enter an email address, like name@example.com.' },
    });
    expect(validateForm(loginBodySchema, { email: 'Lan@Example.com', password: 'x' }, en)).toEqual({
      ok: true,
      data: { email: 'lan@example.com', password: 'x' },
    });
    const reset = validateForm(resetPasswordBodySchema, { token: 't', newPassword: 'short' }, en, {
      newPassword: passwordShort(en),
    });
    expect(reset.ok ? null : reset.errors).toEqual({
      newPassword: 'Too short: 5 characters. Use at least 10.',
    });
  });

  it('map a server VALIDATION_FAILED by its path, generically where it has no numbers', () => {
    const errors = serverFieldErrors(
      {
        issues: [
          { path: '/description', code: 'too_small' },
          { path: '/phone', code: 'invalid_type' },
        ],
      },
      { description: 'short', phone: '' },
      en,
    );
    expect(errors).toEqual({ description: 'Check this field.', phone: 'This is required.' });
    expect(errorCount(errors)).toBe(2);
    expect(serverFieldErrors(undefined, {}, en)).toEqual({});
  });
});
