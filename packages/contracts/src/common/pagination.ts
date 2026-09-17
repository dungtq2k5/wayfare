import { z } from 'zod';
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from '../limits/rate-limits';

const zLimit = z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT);

/** A cursor list's query (conventions §5.5). The cursor is opaque. */
export const zCursorQuery = z
  .object({
    cursor: z.string().min(1).max(512).optional(),
    limit: zLimit,
  })
  .strict();

/** A cursor list's `meta`. */
export const zCursorMeta = z.object({ nextCursor: z.string().nullable() }).strict();

/** A page list's `meta`. */
export const zPageMeta = z
  .object({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
  })
  .strict();

/** Upper bound of a page list's free-text search. */
export const MAX_SEARCH_LENGTH = 100;

/** Options for `zPageQuery`. */
export interface PageQueryOptions<Field extends string> {
  /** The sort allowlist: the fields a client may order by. */
  readonly sort: readonly [Field, ...Field[]];
  /** The default order, `field` or `-field`; must use an allowlisted field. */
  readonly defaultSort: Field | `-${Field}`;
  /** Adds the free-text `q` parameter. Without it, `q` is refused like any unknown key. */
  readonly search?: true;
}

const searchShape = { q: z.string().trim().min(1).max(MAX_SEARCH_LENGTH).optional() };

function pageShape<Field extends string>(options: PageQueryOptions<Field>) {
  const allowed: readonly string[] = options.sort;
  const fieldOf = (value: string): string => (value.startsWith('-') ? value.slice(1) : value);
  if (!allowed.includes(fieldOf(options.defaultSort))) {
    throw new Error(`zPageQuery: default sort ${options.defaultSort} is not in the allowlist`);
  }
  const sort = z
    .string()
    .refine((value) => allowed.includes(fieldOf(value)), { message: 'Unsupported sort field' })
    .default(options.defaultSort)
    .transform((value) => value as Field | `-${Field}`);
  return {
    page: z.coerce.number().int().min(1).default(1),
    pageSize: zLimit,
    sort,
  };
}

/**
 * A page list's query (conventions §5.5): `page`, `pageSize`, `sort` from the allowlist as `field`
 * or `-field`, and `q` only when the route searches. An unlisted sort is a 400, never an `orderBy`.
 * Routes add their filters with `.extend`.
 */
export function zPageQuery<Field extends string>(
  options: PageQueryOptions<Field> & { readonly search: true },
): z.ZodObject<ReturnType<typeof pageShape<Field>> & typeof searchShape, z.core.$strict>;
export function zPageQuery<Field extends string>(
  options: PageQueryOptions<Field>,
): z.ZodObject<ReturnType<typeof pageShape<Field>>, z.core.$strict>;
export function zPageQuery<Field extends string>(options: PageQueryOptions<Field>) {
  const shape = pageShape(options);
  return options.search
    ? z.object({ ...shape, ...searchShape }).strict()
    : z.object(shape).strict();
}
