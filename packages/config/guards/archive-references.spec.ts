// Guard: nothing tracked points into the git-ignored docs scratch folder — by path, by relative
// link, or as a working-doc citation (docs/README.md "Working documents", conventions §17.4).
import { describe, expect, it } from 'vitest';
import { listFiles, readRepoFile } from './support/repo';

/** Files that must spell the patterns, with the reason. Each entry is checked to still be needed. */
const EXEMPT: Readonly<Record<string, string>> = {
  'packages/config/guards/archive-references.spec.ts':
    'this spec has to spell the patterns it forbids',
  '.gitignore': 'it has to spell the path in order to ignore it',
};

const SKIPPED = [/(^|\/)generated\//, /(^|\/)dist\//, /^pnpm-lock\.yaml$/];

const PATTERNS: readonly (readonly [string, RegExp])[] = [
  ['working-doc citation', /\b[Dd]ocs?\s+\d+/],
  ['path into the archive', /docs\/archive\b/],
  ['relative link into the archive', /\]\((?:\.\.?\/)*archive\//],
  // A working doc's decision label, as code cites it: `(D10)`, `(D1, D2)`. Bare `D10` is left
  // alone — too common in other senses to refuse.
  ['working-doc decision label', /\(\s*D\d{1,2}\b[^)]*\)/],
];
const WRAPPED_HEAD = /\b[Dd]ocs?\s*$/;
const COMMENT_LEADER = /^\s*(?:\*|\/\/|#)\s*/;

/** Every forbidden reference in one file's text, as `file:line: problem`. */
export function scanText(file: string, text: string): string[] {
  const problems: string[] = [];
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    for (const [label, pattern] of PATTERNS) {
      if (pattern.test(line)) problems.push(`${file}:${index + 1}: ${label}: ${line.trim()}`);
    }
    const next = lines[index + 1];
    if (
      WRAPPED_HEAD.test(line) &&
      next !== undefined &&
      /^\d/.test(next.replace(COMMENT_LEADER, ''))
    ) {
      problems.push(`${file}:${index + 1}: working-doc citation wrapped onto the next line`);
    }
  });
  return problems;
}

function corpus(): string[] {
  return listFiles().filter((file) => !SKIPPED.some((pattern) => pattern.test(file)));
}

function readText(file: string): string | null {
  try {
    const text = readRepoFile(file);
    return text.includes('\u0000') ? null : text; // binary
  } catch {
    return null;
  }
}

describe('archive references', () => {
  it('appear nowhere outside the exemptions', () => {
    const problems = corpus()
      .filter((file) => !(file in EXEMPT))
      .flatMap((file) => {
        const text = readText(file);
        return text === null ? [] : scanText(file, text);
      });
    expect(problems).toEqual([]);
  });

  it('keeps every exemption needed', () => {
    for (const file of Object.keys(EXEMPT)) {
      const text = readText(file);
      expect(text, `${file} no longer exists`).not.toBeNull();
      expect(scanText(file, text ?? ''), `${file} no longer needs its exemption`).not.toEqual([]);
    }
  });

  it('reports every forbidden shape', () => {
    const planted = [
      'see doc 03 for the details',
      'Docs 04–06 cover it',
      'moved to docs/archive/impls',
      'see [the plan](../archive/impls/01.md)',
      'see [the plan](archive/impls/01.md)',
      '/** the same thing (D10). */',
      '// both at once (D1, D2)',
    ];
    for (const line of planted) expect(scanText('x.md', line), line).toHaveLength(1);
    expect(scanText('x.ts', '// the details are in doc\n// 03 §2')).toHaveLength(1);
    expect(scanText('x.yaml', '# described in the docs\n# 12 steps later')).toHaveLength(1);
  });

  it('accepts the conforming shapes', () => {
    const accepted = [
      'see ADR 0042',
      'conventions §13',
      'docs/decisions/0043-access-tokens-are-asymmetrically-signed.md',
      'a doc comment',
      'Measured: 471 tests',
      'The same rule covers `archive/`: it is scratch',
      'a sentence that ends in doc\nand continues without a digit',
      'a D10 lens (DSLR)',
      'the device (DEVICE marker)',
      'grid cell D4',
    ];
    for (const text of accepted) expect(scanText('x.md', text), text).toEqual([]);
  });

  it('scans the real repository', () => {
    const files = corpus();
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain('docs/development-conventions.md');
  });
});
