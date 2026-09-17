// Guard: api-endpoints-plan's permission registry, seeded roles, error codes and event subjects
// agree with the registries in packages/contracts, in both directions (conventions §17.4).
import {
  ADMIN_EXCLUDED_PERMISSIONS,
  compareStrings,
  DEFAULT_ROLES,
  ERRORS,
  EVENT_DEFINITIONS,
  PERMISSION_CODES,
  SYSTEM_ROLE_GRANTS,
  SYSTEM_ROLES,
} from '@wayfare/contracts';
import type { ErrorCode, EventPublisher } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { readRepoFile } from './support/repo';

/**
 * Registry codes api-endpoints-plan never writes as `NNN CODE`. Each must stay absent from the
 * doc's pairs: once the doc names one, its exemption is stale.
 */
const CODES_WITHOUT_PAIRS: ReadonlySet<ErrorCode> = new Set<ErrorCode>([]);

/** What the guard reads from api-endpoints-plan. */
export interface ApiContract {
  readonly permissions: readonly string[];
  readonly systemRoles: readonly string[];
  readonly adminExcluded: readonly string[];
  readonly venueOwnerGrants: readonly string[];
  readonly contentModerator: readonly string[];
  /** Every `NNN CODE` pair, deduplicated, as `[status, code]`. */
  readonly errorPairs: readonly (readonly [number, string])[];
  readonly subjects: readonly { readonly subject: string; readonly publisher: string }[];
}

/** What the guard compares it with. */
export interface CodeContract {
  readonly permissions: readonly string[];
  readonly systemRoles: readonly string[];
  readonly adminExcluded: readonly string[];
  readonly venueOwnerGrants: readonly string[];
  readonly contentModerator: readonly string[];
  readonly errors: Readonly<Record<string, { readonly http: number }>>;
  readonly codesWithoutPairs: ReadonlySet<string>;
  readonly subjects: readonly { readonly subject: string; readonly publisher: EventPublisher }[];
}

/** The body of a `## N.` section, up to the next `## `. */
function section(markdown: string, number: number): string {
  const start = markdown.search(new RegExp(`^## ${number}\\. `, 'm'));
  if (start < 0) throw new Error(`api-endpoints-plan §${number} not found`);
  const rest = markdown.slice(start + 1);
  const end = rest.search(/^## /m);
  return end < 0 ? markdown.slice(start) : markdown.slice(start, start + 1 + end);
}

function tableRows(markdown: string): string[][] {
  return markdown
    .split('\n')
    .filter((line) => line.startsWith('|') && !/^\|\s*:?-/.test(line))
    .map((line) =>
      line
        .split(/(?<!\\)\|/)
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
}

const backticked = (text: string): string[] =>
  [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]!);

/** Reads the four contracts out of api-endpoints-plan. */
export function extractApiContract(markdown: string): ApiContract {
  const registry = section(markdown, 11);
  const block = /```txt\n([\s\S]*?)```/.exec(registry)?.[1] ?? '';
  const permissions = block.split(/\s+/).filter((token) => token.length > 0);

  const roles = new Map<string, { system: string; grants: string }>();
  for (const [role, system, grants] of tableRows(registry)) {
    const name = /^`([A-Z_]+)`$/.exec(role ?? '')?.[1];
    if (name !== undefined) roles.set(name, { system: system ?? '', grants: grants ?? '' });
  }
  const systemRoles = [...roles]
    .filter(([, row]) => row.system.startsWith('yes'))
    .map(([name]) => name);
  const adminGrants = roles.get('ADMIN')?.grants ?? '';
  const exceptAt = adminGrants.indexOf('**except**');

  const pairs = new Map<string, readonly [number, string]>();
  for (const [, status, code] of markdown.matchAll(/\b([1-5]\d\d) `?([A-Z][A-Z0-9_]{2,})\b/g)) {
    pairs.set(`${status} ${code}`, [Number(status), code!]);
  }

  const subjects: { subject: string; publisher: string }[] = [];
  for (const [subject, publisher] of tableRows(section(markdown, 10))) {
    const name = /^`([a-z_]+(?:\.[a-z_]+)+)`$/.exec(subject ?? '')?.[1];
    if (name !== undefined) {
      subjects.push({
        subject: name,
        publisher: publisher === 'every service' ? 'any' : (publisher ?? ''),
      });
    }
  }

  return {
    permissions,
    systemRoles,
    adminExcluded: exceptAt < 0 ? [] : backticked(adminGrants.slice(exceptAt)),
    venueOwnerGrants: backticked(roles.get('VENUE_OWNER')?.grants ?? ''),
    contentModerator: backticked(roles.get('CONTENT_MODERATOR')?.grants ?? ''),
    errorPairs: [...pairs.values()],
    subjects,
  };
}

function sameSet(
  label: string,
  doc: readonly string[],
  code: readonly string[],
  problems: string[],
): void {
  for (const value of doc)
    if (!code.includes(value)) problems.push(`${label}: ${value} is in the doc, not in code`);
  for (const value of code)
    if (!doc.includes(value)) problems.push(`${label}: ${value} is in code, not in the doc`);
}

/** Every disagreement between the doc and the registries. */
export function checkApiContract(doc: ApiContract, code: CodeContract): string[] {
  const problems: string[] = [];

  sameSet('permissions', doc.permissions, code.permissions, problems);
  const shared = doc.permissions.filter((value) => code.permissions.includes(value));
  const codeOrder = code.permissions.filter((value) => doc.permissions.includes(value));
  const moved = shared.findIndex((value, index) => value !== codeOrder[index]);
  if (moved >= 0)
    problems.push(`permissions: out of order from ${shared[moved]} (code has ${codeOrder[moved]})`);

  sameSet('system roles', doc.systemRoles, code.systemRoles, problems);
  sameSet('ADMIN exclusions', doc.adminExcluded, code.adminExcluded, problems);
  sameSet('VENUE_OWNER grants', doc.venueOwnerGrants, code.venueOwnerGrants, problems);
  sameSet('CONTENT_MODERATOR grants', doc.contentModerator, code.contentModerator, problems);

  const pairedCodes = new Set<string>();
  for (const [status, name] of doc.errorPairs) {
    pairedCodes.add(name);
    const spec = code.errors[name];
    if (spec === undefined) problems.push(`errors: ${status} ${name} is in the doc, not in ERRORS`);
    else if (spec.http !== status)
      problems.push(`errors: the doc answers ${name} with ${status}, ERRORS with ${spec.http}`);
  }
  for (const name of Object.keys(code.errors)) {
    const exempt = code.codesWithoutPairs.has(name);
    if (!exempt && !pairedCodes.has(name))
      problems.push(`errors: ${name} is in ERRORS, but the doc never names it with a status`);
    if (exempt && pairedCodes.has(name))
      problems.push(`errors: ${name} is paired in the doc now — drop its exemption`);
  }

  const docSubjects = new Map(doc.subjects.map((entry) => [entry.subject, entry.publisher]));
  const codeSubjects = new Map(code.subjects.map((entry) => [entry.subject, entry.publisher]));
  sameSet('subjects', [...docSubjects.keys()], [...codeSubjects.keys()], problems);
  for (const [subject, publisher] of docSubjects) {
    const registered = codeSubjects.get(subject);
    if (registered !== undefined && registered !== publisher) {
      problems.push(
        `subjects: the doc says ${subject} is published by ${publisher}, the registry by ${registered}`,
      );
    }
  }
  return problems;
}

const CODE: CodeContract = {
  permissions: PERMISSION_CODES,
  systemRoles: SYSTEM_ROLES,
  adminExcluded: ADMIN_EXCLUDED_PERMISSIONS,
  venueOwnerGrants: SYSTEM_ROLE_GRANTS.VENUE_OWNER,
  contentModerator: DEFAULT_ROLES.CONTENT_MODERATOR,
  errors: ERRORS,
  codesWithoutPairs: CODES_WITHOUT_PAIRS,
  subjects: EVENT_DEFINITIONS,
};

// ── Synthetic fixtures ─────────────────────────────────────────────────────────

const FIXTURE_DOC = [
  '## 1. Routes',
  'Refused with `409 THING_TAKEN`, or 404 THING_MISSING.',
  '',
  '## 10. Events',
  '',
  '| Subject | Publisher | Payload | Consumers |',
  '| :---- | :---- | :---- | :---- |',
  '| `thing.item.made` | thing | `id` | x |',
  '| `audit.record` | every service | `eventId` | x |',
  '',
  '## 11. Permission registry',
  '',
  '```txt',
  'thing.read        thing.write',
  'admin.access',
  '```',
  '',
  '| Role | System | Grants |',
  '| :---- | :---- | :---- |',
  '| `SUPER_ADMIN` | yes | every code |',
  '| `ADMIN` | yes | every code **except** `thing.write` — the risky one |',
  '| `VENUE_OWNER` | yes | `admin.access` |',
  '| `CONTENT_MODERATOR` | **no** — editable | `thing.read` |',
  '',
  '## 12. Next',
].join('\n');

const FIXTURE_CODE: CodeContract = {
  permissions: ['thing.read', 'thing.write', 'admin.access'],
  systemRoles: ['SUPER_ADMIN', 'ADMIN', 'VENUE_OWNER'],
  adminExcluded: ['thing.write'],
  venueOwnerGrants: ['admin.access'],
  contentModerator: ['thing.read'],
  errors: { THING_TAKEN: { http: 409 }, THING_MISSING: { http: 404 }, GATEWAY_ONLY: { http: 400 } },
  codesWithoutPairs: new Set(['GATEWAY_ONLY']),
  subjects: [
    { subject: 'thing.item.made', publisher: 'catalog' },
    { subject: 'audit.record', publisher: 'any' },
  ],
};

const fixtureCode = (subjects = FIXTURE_CODE.subjects): CodeContract => ({
  ...FIXTURE_CODE,
  subjects,
});

describe('api-contract sync', () => {
  it('holds between api-endpoints-plan and packages/contracts', () => {
    expect(
      checkApiContract(extractApiContract(readRepoFile('docs/api-endpoints-plan.md')), CODE),
    ).toEqual([]);
  });

  it('accepts a conforming fixture', () => {
    const doc = extractApiContract(FIXTURE_DOC.replace('| thing |', '| catalog |'));
    expect(doc.adminExcluded).toEqual(['thing.write']);
    expect(checkApiContract(doc, fixtureCode())).toEqual([]);
  });

  it('reports every kind of drift', () => {
    const conforming = FIXTURE_DOC.replace('| thing |', '| catalog |');
    const cases: [string, string, CodeContract, RegExp][] = [
      [
        'a code with a different status',
        conforming.replace('`409 THING_TAKEN`', '`422 THING_TAKEN`'),
        FIXTURE_CODE,
        /answers THING_TAKEN with 422, ERRORS with 409/,
      ],
      [
        'a code missing from the registry',
        conforming.replace('THING_MISSING', 'THING_GONE'),
        FIXTURE_CODE,
        /404 THING_GONE is in the doc, not in ERRORS/,
      ],
      [
        'a registry code the doc never names',
        conforming.replace(', or 404 THING_MISSING', ''),
        FIXTURE_CODE,
        /THING_MISSING is in ERRORS, but the doc never names it/,
      ],
      [
        'a stale exemption',
        conforming.replace('.\n', ', or `400 GATEWAY_ONLY`.\n'),
        FIXTURE_CODE,
        /GATEWAY_ONLY is paired in the doc now/,
      ],
      [
        'a subject missing from the registry',
        conforming,
        fixtureCode([{ subject: 'audit.record', publisher: 'any' }]),
        /subjects: thing\.item\.made is in the doc, not in code/,
      ],
      [
        'a subject with another publisher',
        FIXTURE_DOC,
        FIXTURE_CODE,
        /published by thing, the registry by catalog/,
      ],
      [
        'a permission out of order',
        conforming,
        { ...FIXTURE_CODE, permissions: ['thing.write', 'thing.read', 'admin.access'] },
        /permissions: out of order from thing\.read/,
      ],
      [
        'a permission missing from code',
        conforming,
        { ...FIXTURE_CODE, permissions: ['thing.read', 'thing.write'] },
        /admin\.access is in the doc, not in code/,
      ],
      [
        'a changed ADMIN exclusion',
        conforming,
        { ...FIXTURE_CODE, adminExcluded: ['thing.read'] },
        /ADMIN exclusions: thing\.write is in the doc/,
      ],
      [
        'a changed moderator grant',
        conforming,
        { ...FIXTURE_CODE, contentModerator: [] },
        /CONTENT_MODERATOR grants: thing\.read/,
      ],
      [
        'a system role missing',
        conforming,
        { ...FIXTURE_CODE, systemRoles: ['SUPER_ADMIN', 'ADMIN'] },
        /system roles: VENUE_OWNER/,
      ],
    ];
    for (const [label, doc, code, expected] of cases) {
      expect(checkApiContract(extractApiContract(doc), code).join('\n'), label).toMatch(expected);
    }
  });

  it('extracts enough of the real doc to mean something', () => {
    const doc = extractApiContract(readRepoFile('docs/api-endpoints-plan.md'));
    expect(doc.permissions.length).toBeGreaterThanOrEqual(40);
    expect(doc.errorPairs.length).toBeGreaterThanOrEqual(45);
    expect(doc.subjects.length).toBeGreaterThanOrEqual(24);
    expect(doc.systemRoles).toContain('SUPER_ADMIN');
    expect(doc.contentModerator.length).toBeGreaterThan(0);
    expect([...CODES_WITHOUT_PAIRS].toSorted(compareStrings)).toEqual([...CODES_WITHOUT_PAIRS]);
  });
});
