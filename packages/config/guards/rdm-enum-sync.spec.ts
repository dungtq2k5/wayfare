// Guard: every enumerated column in rdm-spec and its TS enum in packages/contracts hold the same
// values, in both directions (rdm-spec §0, conventions §17.4).
import {
  ACCOUNT_RECOVERY_STATUSES,
  ACTION_TOKEN_PURPOSES,
  AI_OUTCOMES,
  AI_PROVIDERS,
  AI_PURPOSES,
  ANALYTICS_EVENT_TYPES,
  ANALYTICS_LEVELS,
  ANALYTICS_TRIGGERS,
  AUDIO_STATUSES,
  AUDIO_TIERS,
  AUDIT_ACTOR_TYPES,
  AUDIT_RESOURCE_TYPES,
  BILLING_EVENT_STATUSES,
  BILLING_INTERVALS,
  BOOST_ENDED_REASONS,
  CATEGORY_APPLIES_TO_VALUES,
  compareStrings,
  CONSENT_STATES,
  CURRENCY_CODES,
  DISPUTE_STATUSES,
  EMAIL_BOUNCE_TYPES,
  EMAIL_DELIVERY_STATUSES,
  EMAIL_PROVIDERS,
  EMAIL_TEMPLATES,
  LEGAL_DOCUMENTS,
  LOCALIZATION_TARGET_TYPES,
  MAP_PACK_STATUSES,
  MENU_CURRENCIES,
  NARRATION_LANGUAGE_SCOPES,
  NOTIFICATION_TYPES,
  OFFER_TRANSLATION_SOURCES,
  ORDER_STATUSES,
  OVERRIDE_STATUSES,
  OVERRIDE_TARGET_TYPES,
  OWNER_REGISTRATION_STATUSES,
  PLACE_INACTIVE_REASONS,
  PLACE_KINDS,
  PLACE_STATUSES,
  PLATFORMS,
  RECOVERY_EVIDENCE_CODES,
  REFUND_REASONS,
  REFUND_STATUSES,
  REPLACEMENT_TYPES,
  SESSION_CLIENTS,
  SESSION_REVOKED_REASONS,
  STAFF_MEMBERSHIP_STATUSES,
  STRIPE_ENDPOINTS,
  SUBMISSION_KINDS,
  SUBMISSION_STATUSES,
  SUBSCRIPTION_STATUSES,
  SYNTHESIS_JOB_STATUSES,
  SYNTHESIS_STAGES,
  SYNTHESIS_TASK_STATUSES,
  SYNTHESIS_TRIGGERS,
  TOUR_STATUSES,
  TRANSFERS_STATUSES,
  TRANSLATION_SOURCES,
  UI_BUNDLE_ORIGINS,
  UI_BUNDLE_STATUSES,
  UPLOAD_PURPOSES,
  VOUCHER_OFFER_STATUSES,
  VOUCHER_STATUSES,
  VOUCHER_VOID_REASONS,
} from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { readRepoFile } from './support/repo';

/** One enumerated column as rdm-spec writes it. */
export interface RdmEnumColumn {
  /** `I-2 platform`. */
  readonly key: string;
  readonly values: readonly string[];
}

/**
 * Each enumerated column → the values its TS enum holds (conventions §8.4). A subset column maps
 * to its subset constant, not to the full enum.
 */
export const RDM_ENUMS: Readonly<Record<string, readonly string[]>> = {
  'I-2 platform': PLATFORMS,
  'I-3 client': SESSION_CLIENTS,
  'I-3 revoked_reason': SESSION_REVOKED_REASONS,
  'I-8 status': OWNER_REGISTRATION_STATUSES,
  'I-9 purpose': ACTION_TOKEN_PURPOSES,
  'I-10 type': NOTIFICATION_TYPES,
  'I-11 actor_type': AUDIT_ACTOR_TYPES,
  'I-11 resource_type': AUDIT_RESOURCE_TYPES,
  'I-12 document': LEGAL_DOCUMENTS,
  'I-13 template': EMAIL_TEMPLATES,
  'I-13 provider': EMAIL_PROVIDERS,
  'I-13 status': EMAIL_DELIVERY_STATUSES,
  'I-13 bounce_type': EMAIL_BOUNCE_TYPES,
  'I-14 status': ACCOUNT_RECOVERY_STATUSES,
  'I-14 evidence_codes': RECOVERY_EVIDENCE_CODES,
  'C-1 kind': PLACE_KINDS,
  'C-1 status': PLACE_STATUSES,
  'C-1 inactive_reason': PLACE_INACTIVE_REASONS,
  'C-1 menu_currency': MENU_CURRENCIES,
  'C-2 applies_to': CATEGORY_APPLIES_TO_VALUES,
  'C-4 translation_source': TRANSLATION_SOURCES,
  'C-4 audio_status': AUDIO_STATUSES,
  'C-7 translation_source': TRANSLATION_SOURCES,
  'C-8 status': TOUR_STATUSES,
  'C-9 translation_source': TRANSLATION_SOURCES,
  'C-11 kind': SUBMISSION_KINDS,
  'C-11 status': SUBMISSION_STATUSES,
  'C-12 purpose': UPLOAD_PURPOSES,
  'C-14 status': MAP_PACK_STATUSES,
  'N-1 target_type': LOCALIZATION_TARGET_TYPES,
  'N-1 trigger': SYNTHESIS_TRIGGERS,
  'N-1 status': SYNTHESIS_JOB_STATUSES,
  'N-2 stage': SYNTHESIS_STAGES,
  'N-2 status': SYNTHESIS_TASK_STATUSES,
  'N-5 replacement_type': REPLACEMENT_TYPES,
  'N-6 status': UI_BUNDLE_STATUSES,
  'N-6 origin': UI_BUNDLE_ORIGINS,
  'N-7 target_type': OVERRIDE_TARGET_TYPES,
  'N-7 status': OVERRIDE_STATUSES,
  'B-1 narration_language_scope': NARRATION_LANGUAGE_SCOPES,
  'B-1 analytics_level': ANALYTICS_LEVELS,
  'B-2 billing_interval': BILLING_INTERVALS,
  'B-2 currency': CURRENCY_CODES,
  'B-3 subscription_status': SUBSCRIPTION_STATUSES,
  'B-4 endpoint': STRIPE_ENDPOINTS,
  'B-4 status': BILLING_EVENT_STATUSES,
  'B-5 ended_reason': BOOST_ENDED_REASONS,
  'B-6 transfers_status': TRANSFERS_STATUSES,
  'B-7 status': VOUCHER_OFFER_STATUSES,
  'B-7 currency': CURRENCY_CODES,
  'B-8 translation_source': OFFER_TRANSLATION_SOURCES,
  'B-9 status': ORDER_STATUSES,
  'B-9 currency': CURRENCY_CODES,
  'B-10 status': VOUCHER_STATUSES,
  'B-10 void_reason': VOUCHER_VOID_REASONS,
  'B-11 reason': REFUND_REASONS,
  'B-11 status': REFUND_STATUSES,
  'B-11 currency': CURRENCY_CODES,
  'B-12 status': DISPUTE_STATUSES,
  'B-12 currency': CURRENCY_CODES,
  'B-13 status': STAFF_MEMBERSHIP_STATUSES,
  'A-1 state': CONSENT_STATES,
  'A-2 event_type': ANALYTICS_EVENT_TYPES,
  'A-2 trigger': ANALYTICS_TRIGGERS,
  'A-2 audio_tier': AUDIO_TIERS,
  'X-1 provider': AI_PROVIDERS,
  'X-1 purpose': AI_PURPOSES,
  'X-1 outcome': AI_OUTCOMES,
};

const TOKEN = '[A-Z][A-Z0-9_]*';
/** Spelling 1: one backtick span, `` `A \| B \| C` ``, possibly after a lead-in (`From X: …`). */
const ONE_SPAN = new RegExp(`\`(${TOKEN}(?: \\\\\\| ${TOKEN})+)\``);
/** Spelling 2's segments: each value backticked, prose allowed after it, `` `A` (…) \| `B` ``. */
const SEGMENT = new RegExp(`^\`(${TOKEN})\``);

/** Splits a table row on the pipes that are not escaped. */
function cells(row: string): string[] {
  return row
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((cell) => cell.trim());
}

/** The values a description cell enumerates, or null when it enumerates none. */
export function enumeratedValues(column: string, description: string): string[] | null {
  const span = ONE_SPAN.exec(description);
  if (span) return span[1]!.split(' \\| ');
  // Only the first run of backticked values counts; prose after the run is ignored.
  const run: string[] = [];
  for (const segment of description.split(' \\| ')) {
    const value = SEGMENT.exec(segment)?.[1];
    if (value === undefined) break;
    run.push(value);
  }
  if (run.length >= 2) return run;
  // Spelling 3: a CHECK on the column itself — `CHECK (col IN ('A','B'))` or `CHECK (col = 'A')`.
  const check = new RegExp(
    `\`CHECK \\(${column} (?:IN \\(((?:'${TOKEN}',?)+)\\)|= '(${TOKEN})')\\)\``,
  ).exec(description);
  if (check?.[1] !== undefined) return check[1].split(',').map((value) => value.slice(1, -1));
  if (check?.[2] !== undefined) return [check[2]];
  return null;
}

/** Every enumerated column in rdm-spec, keyed `<table id> <column>`. */
export function extractRdmEnums(rdmSpec: string): RdmEnumColumn[] {
  const columns: RdmEnumColumn[] = [];
  let table: string | null = null;
  for (const line of rdmSpec.split('\n')) {
    const heading = /^#{2,6} Table ([A-Z]-\d+):/.exec(line);
    if (heading) {
      table = heading[1]!;
      continue;
    }
    if (/^#{1,3} /.test(line)) table = null; // a new section ends the table
    if (table === null || !line.startsWith('| **')) continue;
    const [name, , , description] = cells(line);
    const column = /^\*\*([a-z0-9_]+)\*\*$/.exec(name ?? '')?.[1];
    if (column === undefined || description === undefined) continue;
    const values = enumeratedValues(column, description);
    if (values !== null) columns.push({ key: `${table} ${column}`, values });
  }
  return columns;
}

/** Every disagreement between the extracted columns and the mapping. */
export function checkRdmEnums(
  columns: readonly RdmEnumColumn[],
  mapping: Readonly<Record<string, readonly string[]>>,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const { key, values } of columns) {
    seen.add(key);
    const code = mapping[key];
    if (code === undefined) {
      problems.push(
        `${key}: enumerated in rdm-spec (${values.join(' | ')}) but mapped to no TS enum`,
      );
      continue;
    }
    const missing = values.filter((value) => !code.includes(value));
    const extra = code.filter((value) => !values.includes(value));
    if (missing.length > 0)
      problems.push(`${key}: rdm-spec has ${missing.join(', ')}, the TS enum does not`);
    if (extra.length > 0)
      problems.push(`${key}: the TS enum has ${extra.join(', ')}, rdm-spec does not`);
  }
  for (const key of Object.keys(mapping).toSorted(compareStrings)) {
    if (!seen.has(key))
      problems.push(`${key}: mapped, but rdm-spec no longer enumerates it — a stale mapping`);
  }
  return problems;
}

// ── Synthetic fixtures ─────────────────────────────────────────────────────────

const FIXTURE = [
  '#### Table T-1: things',
  '',
  '| Field | Type | Constraints / Default | Description & business logic |',
  '| :---- | :---- | :---- | :---- |',
  '| **status** | VARCHAR(16) | NOT NULL | `DRAFT \\| ACTIVE`. Moves to `ACTIVE` \\| never back, NOT NULL once set. |',
  '| **scope** | VARCHAR(16) | NOT NULL | `BASIC` (`vi`, `en`) \\| `LAUNCH` (all five) \\| `EXTENDED` (plus `LONG_TAIL`). |',
  "| **currency** | CHAR(3) | NOT NULL | `CHECK (currency IN ('VND','USD'))`. |",
  "| **note** | TEXT | Nullable | `CHECK (status = 'ACTIVE' OR note IS NULL)` — not an enumeration. |",
  '| **kind** | VARCHAR(16) | NOT NULL | — |',
  '| **codes** | VARCHAR(32)[] | NOT NULL | Checks that passed: `PHONE \\| EMAIL`. `CHECK (cardinality(codes) >= 1)`. |',
  '',
  '## 3. Next',
  '| **ignored** | VARCHAR | NOT NULL | `A \\| B` |',
].join('\n');

const FIXTURE_MAPPING = {
  'T-1 status': ['DRAFT', 'ACTIVE'],
  'T-1 scope': ['BASIC', 'LAUNCH', 'EXTENDED'],
  'T-1 currency': ['VND', 'USD'],
  'T-1 codes': ['PHONE', 'EMAIL'],
};

describe('rdm-enum sync', () => {
  it('holds between rdm-spec and packages/contracts', () => {
    expect(checkRdmEnums(extractRdmEnums(readRepoFile('docs/rdm-spec.md')), RDM_ENUMS)).toEqual([]);
  });

  it('accepts conforming spellings: a list followed by prose, NOT NULL in the same cell, per-value backticks', () => {
    const columns = extractRdmEnums(FIXTURE);
    expect(columns).toEqual([
      { key: 'T-1 status', values: ['DRAFT', 'ACTIVE'] },
      { key: 'T-1 scope', values: ['BASIC', 'LAUNCH', 'EXTENDED'] },
      { key: 'T-1 currency', values: ['VND', 'USD'] },
      { key: 'T-1 codes', values: ['PHONE', 'EMAIL'] },
    ]);
    expect(checkRdmEnums(columns, FIXTURE_MAPPING)).toEqual([]);
  });

  it('reports every kind of drift', () => {
    const cases: [string, string, Record<string, readonly string[]>, RegExp][] = [
      [
        'a value added in the spec only',
        FIXTURE.replace('`DRAFT \\| ACTIVE`', '`DRAFT \\| ACTIVE \\| ARCHIVED`'),
        FIXTURE_MAPPING,
        /T-1 status: rdm-spec has ARCHIVED/,
      ],
      [
        'a value added in code only',
        FIXTURE,
        { ...FIXTURE_MAPPING, 'T-1 status': ['DRAFT', 'ACTIVE', 'PAUSED'] },
        /T-1 status: the TS enum has PAUSED/,
      ],
      [
        'an enumerated column with no mapping',
        FIXTURE.replace(
          '| **kind** | VARCHAR(16) | NOT NULL | — |',
          '| **kind** | VARCHAR(16) | NOT NULL | `A \\| B` |',
        ),
        FIXTURE_MAPPING,
        /T-1 kind: enumerated in rdm-spec .* mapped to no TS enum/,
      ],
      [
        'a stale mapping',
        FIXTURE,
        { ...FIXTURE_MAPPING, 'T-1 gone': ['X'] },
        /T-1 gone: mapped, but rdm-spec no longer/,
      ],
    ];
    for (const [label, doc, mapping, expected] of cases) {
      expect(checkRdmEnums(extractRdmEnums(doc), mapping).join('\n'), label).toMatch(expected);
    }
  });

  it('extracts the real spec, including both backtick spellings', () => {
    const columns = extractRdmEnums(readRepoFile('docs/rdm-spec.md'));
    expect(columns.length).toBeGreaterThanOrEqual(60);
    const keys = columns.map((column) => column.key);
    expect(keys).toEqual(
      expect.arrayContaining(['I-2 platform', 'B-1 narration_language_scope', 'X-1 purpose']),
    );
  });
});
