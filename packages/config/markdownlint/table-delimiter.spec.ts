import { applyFixes } from 'markdownlint';
import { lint } from 'markdownlint/promise';
import { describe, expect, it } from 'vitest';
import tableDelimiter from './table-delimiter.mjs';

async function check(markdown: string) {
  const results = await lint({
    strings: { doc: markdown },
    customRules: [tableDelimiter],
    config: { default: false, 'wayfare-table-delimiter': true },
  });
  const errors = results.doc ?? [];
  return { lines: errors.map((error) => error.lineNumber), fixed: applyFixes(markdown, errors) };
}

describe('wayfare-table-delimiter', () => {
  it('accepts the house style', async () => {
    expect((await check('| A | B |\n| :---- | :---- |\n| 1 | 2 |\n')).lines).toEqual([]);
  });

  it('reports each offending row ONCE and fixes every cell in it', async () => {
    const { lines, fixed } = await check('| A | B | C |\n|---| :-: | ----: |\n| 1 | 2 | 3 |\n');
    expect(lines).toEqual([2]);
    expect(fixed).toBe('| A | B | C |\n|:----| :---- | :---- |\n| 1 | 2 | 3 |\n');
  });

  it('checks tables in lists and without outer pipes', async () => {
    const { lines } = await check('- item\n\n  | A |\n  | --- |\n\nA | B\n--- | :----\n');
    expect(lines).toEqual([4, 7]);
  });

  it('ignores a table-shaped block inside a code fence', async () => {
    expect((await check('```md\n| A |\n| --- |\n```\n')).lines).toEqual([]);
  });
});
