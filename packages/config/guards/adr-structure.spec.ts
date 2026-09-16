// Guard: every ADR follows docs/decisions/TEMPLATE.md (conventions §17.4). Structure only —
// "accepted ADRs are append-only" is a diff property and stays with review.
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareStrings } from '@wayfare/contracts';
import { listFiles, readRepoFile, sectionHeadings } from './support/repo';

const FILE_NAME = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const STATUS_LINE =
  /^\*\*Status:\*\* (Proposed|Accepted|Superseded) · \*\*Date:\*\* (\d{4}-\d{2}-\d{2}) · \*\*Supersedes:\*\* (.+?) · \*\*Superseded by:\*\* (.+)$/;
const LINK = /^\[(\d{4})\]\(\.\/(\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.md)\)( \(in part[^)]*\))?$/;
const TEMPLATE_STATUS_LINE =
  '**Status:** Proposed · **Date:** YYYY-MM-DD · **Supersedes:** — · **Superseded by:** —';

interface Pointer {
  readonly number: string;
  readonly file: string;
  readonly partial: boolean;
}

interface Adr {
  readonly file: string;
  readonly status: string;
  readonly supersedes: readonly Pointer[];
  readonly supersededBy: readonly Pointer[];
}

/** The ADR corpus: file name → text, the template, and the docs index. */
export interface AdrCorpus {
  readonly adrs: ReadonlyMap<string, string>;
  readonly template: string;
  readonly readme: string;
}

function isRealDate(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date);
}

function parsePointers(
  cell: string,
  file: string,
  field: string,
  problems: string[],
): Pointer[] | null {
  if (cell === '—') return [];
  const pointers: Pointer[] = [];
  for (const part of cell.split('; ')) {
    const match = LINK.exec(part);
    if (!match) {
      problems.push(`${file}: ${field} is not "—" or [NNNN](./NNNN-slug.md) links: ${part}`);
      return null;
    }
    const [, number, target, partial] = match as unknown as [string, string, string, string?];
    pointers.push({ number, file: target, partial: partial !== undefined });
  }
  return pointers;
}

/** Every structural problem in the corpus, as `file: problem`. */
export function checkAdrs(corpus: AdrCorpus): string[] {
  const problems: string[] = [];
  const templateSections = sectionHeadings(corpus.template);
  const templateLines = corpus.template.split('\n');

  if (!/^# NNNN — \S/.test(templateLines[0] ?? ''))
    problems.push('TEMPLATE.md: line 1 is not "# NNNN — …"');
  if (templateLines[1] !== '') problems.push('TEMPLATE.md: line 2 is not blank');
  if (templateLines[2] !== TEMPLATE_STATUS_LINE) {
    problems.push('TEMPLATE.md: line 3 is not the Proposed / YYYY-MM-DD / — / — status line');
  }

  const parsed = new Map<string, Adr>();
  for (const [file, text] of corpus.adrs) {
    const name = FILE_NAME.exec(file);
    if (!name) {
      problems.push(`${file}: file name is not NNNN-kebab-assertion.md`);
      continue;
    }
    const number = name[1];
    const lines = text.split('\n');
    const titleNumber = /^# (\d{4}) — \S/.exec(lines[0] ?? '')?.[1];
    if (titleNumber === undefined)
      problems.push(`${file}: line 1 is not "# ${number} — <assertion>"`);
    else if (titleNumber !== number)
      problems.push(`${file}: title number ${titleNumber} does not match the file`);
    if (lines[1] !== '') problems.push(`${file}: line 2 is not blank`);

    const status = STATUS_LINE.exec(lines[2] ?? '');
    if (!status) {
      problems.push(`${file}: line 3 is not the status line`);
    } else {
      const [, state, date, supersedesCell, supersededByCell] = status as unknown as [
        string,
        string,
        string,
        string,
        string,
      ];
      if (!isRealDate(date)) problems.push(`${file}: ${date} is not a real date`);
      const supersedes = parsePointers(supersedesCell, file, 'Supersedes', problems);
      const supersededBy = parsePointers(supersededByCell, file, 'Superseded by', problems);
      if (supersedes && supersededBy) {
        for (const pointer of [...supersedes, ...supersededBy]) {
          if (!corpus.adrs.has(pointer.file))
            problems.push(`${file}: link to missing ${pointer.file}`);
          else if (!pointer.file.startsWith(`${pointer.number}-`)) {
            problems.push(`${file}: link text ${pointer.number} does not match ${pointer.file}`);
          }
        }
        const fullySuperseded = supersededBy.some((pointer) => !pointer.partial);
        if ((state === 'Superseded') !== fullySuperseded) {
          problems.push(
            `${file}: status ${state} disagrees with Superseded by (a full, non-"in part" pointer ⇔ Superseded)`,
          );
        }
        parsed.set(file, { file, status: state, supersedes, supersededBy });
      }
    }

    const sections = sectionHeadings(text);
    const required = templateSections.slice(0, -1);
    const matchesTemplate =
      (sections.length === templateSections.length || sections.length === required.length) &&
      sections.every((heading, index) => heading === templateSections[index]);
    if (!matchesTemplate) {
      problems.push(
        `${file}: sections ${JSON.stringify(sections)} are not ${JSON.stringify(templateSections)} (the last is optional)`,
      );
    }

    if (!corpus.readme.includes(`(./decisions/${file})`))
      problems.push(`${file}: not linked from docs/README.md`);
  }

  for (const adr of parsed.values()) {
    for (const pointer of adr.supersededBy) {
      const other = parsed.get(pointer.file);
      if (
        other &&
        !other.supersedes.some((back) => back.file === adr.file && back.partial === pointer.partial)
      ) {
        problems.push(
          `${adr.file}: Superseded by ${pointer.number}, but ${pointer.file} does not list it the same way`,
        );
      }
    }
    for (const pointer of adr.supersedes) {
      const other = parsed.get(pointer.file);
      if (
        other &&
        !other.supersededBy.some(
          (back) => back.file === adr.file && back.partial === pointer.partial,
        )
      ) {
        problems.push(
          `${adr.file}: Supersedes ${pointer.number}, but ${pointer.file} does not list it the same way`,
        );
      }
    }
  }
  return problems;
}

function loadCorpus(): AdrCorpus {
  const files = listFiles('docs/decisions/*.md')
    .map((path) => basename(path))
    .filter((file) => file !== 'TEMPLATE.md')
    .toSorted(compareStrings);
  return {
    adrs: new Map(files.map((file) => [file, readRepoFile(`docs/decisions/${file}`)])),
    template: readRepoFile('docs/decisions/TEMPLATE.md'),
    readme: readRepoFile('docs/README.md'),
  };
}

// ── Synthetic fixtures ─────────────────────────────────────────────────────────

const TEMPLATE = [
  '# NNNN — A short assertion',
  '',
  TEMPLATE_STATUS_LINE,
  '',
  '## Context',
  '',
  '## Decision',
  '',
  '## Consequences',
  '',
  '## See also',
  '',
].join('\n');

function adr(
  number: string,
  options: {
    title?: string;
    line2?: string;
    status?: string;
    date?: string;
    supersedes?: string;
    supersededBy?: string;
    body?: string;
  } = {},
): string {
  return [
    options.title ?? `# ${number} — Something is decided`,
    options.line2 ?? '',
    `**Status:** ${options.status ?? 'Accepted'} · **Date:** ${options.date ?? '2026-09-16'} · **Supersedes:** ${options.supersedes ?? '—'} · **Superseded by:** ${options.supersededBy ?? '—'}`,
    '',
    options.body ?? '## Context\n\nx\n\n## Decision\n\nx\n\n## Consequences\n\nx\n',
  ].join('\n');
}

function corpusOf(adrs: Record<string, string>, readme?: string): AdrCorpus {
  return {
    adrs: new Map(Object.entries(adrs)),
    template: TEMPLATE,
    readme:
      readme ??
      Object.keys(adrs)
        .map((file) => `[x](./decisions/${file})`)
        .join('\n'),
  };
}

describe('ADR structure', () => {
  it('holds for every ADR in docs/decisions', () => {
    expect(checkAdrs(loadCorpus())).toEqual([]);
  });

  it('reports every kind of violation', () => {
    const cases: [string, AdrCorpus, RegExp][] = [
      ['wrong title number', corpusOf({ '0001-a.md': adr('0002') }), /title number 0002/],
      ['missing title', corpusOf({ '0001-a.md': adr('0001', { title: 'Something' }) }), /line 1/],
      [
        'non-blank line 2',
        corpusOf({ '0001-a.md': adr('0001', { line2: 'x' }) }),
        /line 2 is not blank/,
      ],
      ['unknown status', corpusOf({ '0001-a.md': adr('0001', { status: 'Rejected' }) }), /line 3/],
      [
        'malformed date',
        corpusOf({ '0001-a.md': adr('0001', { date: '2026-13-40' }) }),
        /not a real date/,
      ],
      [
        'dangling link',
        corpusOf({ '0001-a.md': adr('0001', { supersedes: '[0009](./0009-gone.md)' }) }),
        /missing 0009-gone\.md/,
      ],
      [
        'Superseded with only an in-part pointer',
        corpusOf({
          '0001-a.md': adr('0001', {
            status: 'Superseded',
            supersededBy: '[0002](./0002-b.md) (in part)',
          }),
          '0002-b.md': adr('0002', { supersedes: '[0001](./0001-a.md) (in part)' }),
        }),
        /status Superseded disagrees/,
      ],
      [
        'one-sided pointer',
        corpusOf({
          '0001-a.md': adr('0001', { status: 'Superseded', supersededBy: '[0002](./0002-b.md)' }),
          '0002-b.md': adr('0002'),
        }),
        /does not list it the same way/,
      ],
      [
        'section out of order',
        corpusOf({
          '0001-a.md': adr('0001', { body: '## Decision\n\n## Context\n\n## Consequences\n' }),
        }),
        /sections/,
      ],
      [
        'extra ## section',
        corpusOf({
          '0001-a.md': adr('0001', {
            body: '## Context\n\n## Decision\n\n## Consequences\n\n## See also\n\n## Notes\n',
          }),
        }),
        /sections/,
      ],
      [
        'missing index row',
        corpusOf({ '0001-a.md': adr('0001') }, ''),
        /not linked from docs\/README\.md/,
      ],
      ['bad file name', corpusOf({ '1-A.md': adr('0001') }), /file name/],
      [
        'broken template',
        { ...corpusOf({ '0001-a.md': adr('0001') }), template: `<!-- note -->\n${TEMPLATE}` },
        /TEMPLATE\.md: line 1/,
      ],
    ];
    for (const [label, corpus, expected] of cases) {
      expect(checkAdrs(corpus).join('\n'), label).toMatch(expected);
    }
  });

  it('accepts the awkward conforming shapes', () => {
    const corpus = corpusOf({
      '0001-a.md': adr('0001', {
        supersededBy: '[0003](./0003-c.md) (in part — the ESM line)',
        body: '## Context\n\n```md\n## Not a section\n```\n\n### A subsection\n\n## Decision\n\n## Consequences\n\n## See also\n',
      }),
      '0002-b.md': adr('0002', { status: 'Superseded', supersededBy: '[0003](./0003-c.md)' }),
      '0003-c.md': adr('0003', {
        supersedes: '[0001](./0001-a.md) (in part — the ESM line); [0002](./0002-b.md)',
      }),
    });
    expect(checkAdrs(corpus)).toEqual([]);
  });

  it('scans the real, non-empty set of ADRs', () => {
    const corpus = loadCorpus();
    expect(corpus.adrs.size).toBeGreaterThanOrEqual(58); // append-only: the count never drops
    expect(corpus.adrs.has('0058-nest-services-and-shared-packages-are-commonjs.md')).toBe(true);
    expect(sectionHeadings(corpus.template).length).toBeGreaterThanOrEqual(3);
  });
});
