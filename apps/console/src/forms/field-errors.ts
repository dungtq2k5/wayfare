import type { z } from 'zod';
import type { Translator } from '../i18n/messages';

/** A form's errors by field name; a field is absent when it is fine. */
export type FieldErrors = Partial<Record<string, string>>;

/** One issue, as an override reads it. */
export interface IssueFacts {
  readonly code: string;
  readonly count: number;
  readonly minimum: number;
}

/**
 * A field whose error reads differently from the general sentence — the password's (C3), the
 * phone's (P3); `undefined` keeps the general one.
 */
export type IssueOverrides = Partial<Record<string, (issue: IssueFacts) => string | undefined>>;

const lengthOf = (value: unknown): number => (typeof value === 'string' ? value.trim().length : 0);
const blank = (value: unknown): boolean =>
  value === undefined || value === null || lengthOf(value) === 0;

/**
 * One issue's sentence (P3): the schema's own limits and the field's current length — "Write at
 * least 40 characters (now 18)" — or, where the issue carries no numbers, a generic sentence.
 */
function sentence(
  issue: { code: string; minimum?: unknown; maximum?: unknown; format?: unknown },
  field: string,
  value: unknown,
  { t }: Translator,
  overrides: IssueOverrides,
): string {
  if (blank(value)) return t('issue.required');
  const count = lengthOf(value);
  const minimum = Number(issue.minimum);
  const special = overrides[field]?.({ code: issue.code, count, minimum });
  if (special !== undefined) return special;
  switch (issue.code) {
    case 'too_small':
      return t('issue.tooSmall', { minimum, count });
    case 'too_big':
      return t('issue.tooBig', { maximum: Number(issue.maximum), count });
    case 'invalid_format':
      return issue.format === 'email' ? t('issue.email') : t('issue.generic');
    case 'invalid_type':
      return t('issue.required');
    default:
      return t('issue.generic');
  }
}

/** Validates a form with the gateway's own schema (K13): its errors by field, or none. */
export function validateForm<S extends z.ZodType>(
  schema: S,
  values: Record<string, unknown>,
  translator: Translator,
  overrides: IssueOverrides = {},
): { ok: true; data: z.output<S> } | { ok: false; errors: FieldErrors } {
  const result = schema.safeParse(values);
  if (result.success) return { ok: true, data: result.data };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const field = String(issue.path[0] ?? '');
    if (errors[field] !== undefined) continue;
    errors[field] = sentence(issue, field, values[field], translator, overrides);
  }
  return { ok: false, errors };
}

/**
 * A server `VALIDATION_FAILED`'s `details.issues` (JSON-pointer paths) mapped to the fields; it
 * carries no limits, so a length issue reads generically unless the field is empty.
 */
export function serverFieldErrors(
  details: unknown,
  values: Record<string, unknown>,
  translator: Translator,
): FieldErrors {
  const issues = (details as { issues?: unknown } | undefined)?.issues;
  if (!Array.isArray(issues)) return {};
  const errors: FieldErrors = {};
  for (const raw of issues as { path?: unknown; code?: unknown }[]) {
    const field = (typeof raw.path === 'string' ? raw.path : '').split('/')[1] ?? '';
    if (field === '' || errors[field] !== undefined) continue;
    const code = typeof raw.code === 'string' ? raw.code : '';
    errors[field] = sentence(
      { code: code === 'too_small' || code === 'too_big' ? 'generic' : code },
      field,
      values[field],
      translator,
      {},
    );
  }
  return errors;
}

/** How many fields need attention, for the line above the form. */
export const errorCount = (errors: FieldErrors): number =>
  Object.values(errors).filter((value) => value !== undefined).length;

/** The password's own sentence when it is too short (C3): "Too short: 5 characters. Use at least 10." */
export const passwordShort =
  ({ t }: Translator) =>
  ({ code, count, minimum }: IssueFacts): string | undefined =>
    code === 'too_small' ? t('issue.passwordShort', { count, minimum }) : undefined;
