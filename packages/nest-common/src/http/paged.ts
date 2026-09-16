/** A list result: the envelope puts `items` under `data` and `meta` beside it (api-endpoints-plan §0.4). */
export class Paged<T> {
  private constructor(
    readonly items: readonly T[],
    readonly meta: Record<string, unknown>,
  ) {}

  /** A cursor-style page. The cursor is opaque to clients. */
  static cursor<T>(items: readonly T[], nextCursor: string | null): Paged<T> {
    return new Paged(items, { nextCursor });
  }

  /** A page-style page, for console tables. */
  static page<T>(items: readonly T[], page: number, pageSize: number, total: number): Paged<T> {
    return new Paged(items, { page, pageSize, total });
  }
}
