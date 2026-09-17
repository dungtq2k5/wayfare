import { z } from 'zod';

/**
 * A boolean query parameter (conventions §5.2): `true`/`false`/`1`/`0` in any case; anything else is
 * a 400. Never `z.coerce.boolean()`, which reads `"false"` as true. An absent key stays absent.
 */
export const zBooleanParam = z
  .string()
  .transform((value, ctx) => {
    switch (value.toLowerCase()) {
      case 'true':
      case '1':
        return true;
      case 'false':
      case '0':
        return false;
      default:
        ctx.addIssue({ code: 'custom', message: 'Expected true, false, 1 or 0' });
        return z.NEVER;
    }
  })
  .optional();
