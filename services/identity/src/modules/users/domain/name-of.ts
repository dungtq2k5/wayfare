/** What a person's name is read from. */
export interface NamedRow {
  readonly fullName: string | null;
  readonly email: string;
  readonly erasedAt: Date | null;
}

/**
 * A person's name as other people read it (api-endpoints-plan §0's names rule): the full name,
 * else the email; an erased account has none, its email being a placeholder (ADR 0048).
 */
export function nameOf(row: NamedRow): { name?: string } {
  if (row.erasedAt !== null) return {};
  return { name: row.fullName ?? row.email };
}
