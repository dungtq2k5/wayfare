/** A dictionary write, as the fan-out sees it (rdm-spec N-5). */
export interface DictionaryChange {
  /** The term as it stands after the write, or as it stood before a delete. */
  readonly term: string;
  /** The entry's language, or null for every non-`vi` language. */
  readonly targetLang: string | null;
}

/**
 * Which texts a write can have changed the sound of: the term itself, whatever the write was.
 * A create, an edit, a deactivation and a delete all change how the same texts are read — a
 * delete because the alias stops being applied (N-5).
 */
export function fanoutTerms(before: DictionaryChange | null, after: DictionaryChange | null) {
  const changes = [before, after].filter((change): change is DictionaryChange => change !== null);
  const byKey = new Map(
    changes.map((change) => [`${change.term}\u0000${change.targetLang}`, change]),
  );
  return [...byKey.values()];
}
