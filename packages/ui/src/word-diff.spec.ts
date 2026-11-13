import { describe, expect, it } from 'vitest';
import { wordDiff } from './word-diff';

const join = (runs: ReturnType<typeof wordDiff>, kinds: string[]) =>
  runs
    .filter((run) => kinds.includes(run.kind))
    .map((run) => run.text)
    .join('');

describe('the word diff (S2)', () => {
  it('keeps the shared words and marks what was removed and added', () => {
    const before = 'sò điệp nướng mỡ hành. Đông nhất sau tám giờ tối.';
    const after = 'sò điệp nướng mỡ hành và nghêu hấp sả. Đông nhất sau chín giờ tối.';
    const runs = wordDiff(before, after);
    expect(runs.filter((run) => run.kind === 'removed').map((run) => run.text.trim())).toEqual([
      'hành.',
      'tám',
    ]);
    expect(runs.filter((run) => run.kind === 'added').map((run) => run.text.trim())).toEqual([
      'hành và nghêu hấp sả.',
      'chín',
    ]);
    // Each side reads back exactly.
    expect(join(runs, ['same', 'removed'])).toBe(before);
    expect(join(runs, ['same', 'added'])).toBe(after);
  });

  it('handles an empty side', () => {
    expect(wordDiff('', 'Mới.')).toEqual([{ kind: 'added', text: 'Mới.' }]);
    expect(wordDiff('Cũ.', '')).toEqual([{ kind: 'removed', text: 'Cũ.' }]);
    expect(wordDiff('Giống nhau.', 'Giống nhau.')).toEqual([{ kind: 'same', text: 'Giống nhau.' }]);
  });
});
