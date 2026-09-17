/**
 * A result with `meta` beside `data` (conventions §5.1) — composed routes use it to say, for
 * example, `{ degraded: ['billing'] }` (api-endpoints-plan §12.1).
 */
export class WithMeta<T> {
  protected constructor(
    readonly data: T,
    readonly meta: Record<string, unknown>,
  ) {}

  static of<T>(data: T, meta: Record<string, unknown>): WithMeta<T> {
    return new WithMeta(data, meta);
  }
}

/** A list result: the envelope puts `items` under `data` and `meta` beside it (api-endpoints-plan §0.4). */
export class Paged<T> extends WithMeta<readonly T[]> {
  /** The page's items — the same array as `data`. */
  get items(): readonly T[] {
    return this.data;
  }

  /** A cursor-style page. The cursor is opaque to clients. */
  static cursor<T>(items: readonly T[], nextCursor: string | null): Paged<T> {
    return new Paged(items, { nextCursor });
  }

  /** A page-style page, for console tables. */
  static page<T>(items: readonly T[], page: number, pageSize: number, total: number): Paged<T> {
    return new Paged(items, { page, pageSize, total });
  }

  /** The same page with other items — for validation, which may reshape them. */
  withItems<U>(items: readonly U[]): Paged<U> {
    return new Paged(items, this.meta);
  }
}
