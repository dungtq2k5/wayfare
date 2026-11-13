/** One run of a text diff: kept, removed or added words, with their spaces. */
export interface DiffRun {
  readonly kind: 'same' | 'removed' | 'added';
  readonly text: string;
}

/** Words with the space after each, so the runs join back into the texts exactly. */
const tokens = (text: string): string[] => text.match(/\S+\s*|\s+/gu) ?? [];

/**
 * The word diff of two texts (S2): the longest common run of words kept, the rest removed from
 * `before` or added in `after`. Adjacent runs of one kind are merged. ponytail: a full LCS table,
 * fine for a Place's description (≤ 2,000 characters); a Myers diff if texts grow long.
 */
export function wordDiff(before: string, after: string): DiffRun[] {
  const a = tokens(before);
  const b = tokens(after);
  const lengths = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i]![j] =
        a[i]!.trim() === b[j]!.trim()
          ? lengths[i + 1]![j + 1]! + 1
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }
  const runs: DiffRun[] = [];
  const push = (kind: DiffRun['kind'], text: string) => {
    const last = runs.at(-1);
    if (last?.kind === kind) runs[runs.length - 1] = { kind, text: last.text + text };
    else runs.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i]!.trim() === b[j]!.trim()) {
      push('same', b[j]!);
      i++;
      j++;
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) {
      push('removed', a[i++]!);
    } else {
      push('added', b[j++]!);
    }
  }
  while (i < a.length) push('removed', a[i++]!);
  while (j < b.length) push('added', b[j++]!);
  return runs;
}
