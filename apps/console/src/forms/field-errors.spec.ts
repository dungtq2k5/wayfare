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

  it('give the first issue per field, a format’s own sentence, and the generic one otherwise', () => {
    const schema = z.object({
      email: z.email(),
      code: z.string().regex(/^\d+$/).min(4),
      count: z.number(),
      kind: z.enum(['a', 'b']),
    });
    const result = validateForm(
      schema,
      { email: 'not-an-email', code: 'ab', count: 'three', kind: 'c' },
      en,
    );
    expect(result).toEqual({
      ok: false,
      errors: {
        email: en.t('issue.email'),
        code: en.t('issue.generic'),
        count: en.t('issue.required'),
        kind: en.t('issue.generic'),
      },
    });
  });

  it('keep the general sentence where an override has none, and name a form-wide issue blank', () => {
    const schema = z.object({ password: z.string().min(10).max(12) });
    const result = validateForm(schema, { password: 'way too long a password' }, en, {
      password: passwordShort(en),
    });
    expect(result).toEqual({
      ok: false,
      errors: { password: en.t('issue.tooBig', { maximum: 12, count: 23 }) },
    });
    const whole = validateForm(
      z.object({}).refine(() => false),
      {},
      en,
    );
    expect(whole).toEqual({ ok: false, errors: { '': en.t('issue.required') } });
  });

  it('skip a server issue with no field, keep the first per field, and read a missing code generically', () => {
    const errors = serverFieldErrors(
      {
        issues: [
          { path: 42, code: 'too_small' },
          { path: '/name' },
          { path: '/name', code: 'invalid_type' },
          { path: '', code: 'invalid_type' },
        ],
      },
      { name: 'Phở' },
      en,
    );
    expect(errors).toEqual({ name: en.t('issue.generic') });
    expect(serverFieldErrors({ issues: 'none' }, {}, en)).toEqual({});
  });
});
