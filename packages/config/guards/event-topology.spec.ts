// Guard: api-endpoints-plan §10's event table against the code, read as source text — never the
// `CONSUMERS` dependency-injection graph, which is a runtime factory over instances, not a list a
// test can import (conventions §17.4). Also holds every `AuditAction`, `NotificationType` and
// `EmailTemplate` to being produced under `services/*/src` or listed in `PHASE_3_OWED` below.
import { AUDIT_ACTIONS, EMAIL_TEMPLATES, NOTIFICATION_TYPES } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { listFiles, readRepoFile, section, tableRows } from './support/repo';

const SERVICES = ['identity', 'catalog', 'narration', 'billing', 'ai'] as const;
type Service = (typeof SERVICES)[number];

/** `catalog.place.content_changed` → `CATALOG_PLACE_CONTENT_CHANGED`, the registry's own naming. */
function subjectConst(subject: string): string {
  return subject.toUpperCase().replace(/\./g, '_');
}

/** One subject's row, as the doc states it. */
interface DocSubject {
  readonly subject: string;
  readonly publisher: Service | 'any';
  /** True when the consumer cell opens `*(Phase 3, not published yet)*`. */
  readonly notPublishedYet: boolean;
  /** Every consumer clause: which service, and whether it is marked not-yet-built. */
  readonly consumers: readonly { readonly service: Service; readonly marked: boolean }[];
}

const CONSUMER_CLAUSE = /(\*\([^)]*\)\*\s*)?\b(identity|catalog|narration|billing|ai)\s*→/g;

/** Every subject row in api-endpoints-plan §10, with its consumer clauses parsed. */
export function extractEventTopology(markdown: string): readonly DocSubject[] {
  const rows: DocSubject[] = [];
  for (const [subjectCell, publisherCell, , consumersCell] of tableRows(section(markdown, 10))) {
    const subject = /^`([a-z_]+(?:\.[a-z_]+)+)`$/.exec(subjectCell ?? '')?.[1];
    if (subject === undefined) continue;
    const publisher = publisherCell === 'every service' ? 'any' : (publisherCell as Service);
    // A service can appear twice — once for what it does today, once for what Phase 3 adds to the
    // same consumer. Grouped by service: marked only when every clause for it is marked, since an
    // unmarked clause means a consumer class already has to exist.
    const clauses = new Map<Service, boolean>();
    for (const match of (consumersCell ?? '').matchAll(CONSUMER_CLAUSE)) {
      const service = match[2] as Service;
      const marked = match[1] !== undefined;
      clauses.set(service, (clauses.get(service) ?? true) && marked);
    }
    const consumers = [...clauses].map(([service, marked]) => ({ service, marked }));
    rows.push({
      subject,
      publisher,
      notPublishedYet: (consumersCell ?? '').includes('Phase 3, not published yet'),
      consumers,
    });
  }
  return rows;
}

/** Every `*.consumer.ts` file's declared event, with the service it lives under. */
export interface CodeConsumer {
  readonly file: string;
  readonly service: Service;
  readonly subjectConst: string;
}

/** Scans every consumer file for its static `readonly event = X`. */
export function extractConsumers(files: readonly { path: string; text: string }[]): CodeConsumer[] {
  const found: CodeConsumer[] = [];
  for (const { path, text } of files) {
    const service = /^services\/([a-z0-9-]+)\/src\//.exec(path)?.[1];
    if (service === undefined || !(SERVICES as readonly string[]).includes(service)) continue;
    const constant = /readonly event = (\w+)/.exec(text)?.[1];
    if (constant !== undefined)
      found.push({ file: path, service: service as Service, subjectConst: constant });
  }
  return found;
}

/** Whether `services/<service>/src` publishes `subjectConst` via the outbox, anywhere. */
function publishedBy(service: Service | 'any', subjectConst: string, sources: SourceText): boolean {
  const pattern = new RegExp(`outbox\\.(?:add|addMany)\\(tx, ${subjectConst}\\b`);
  const scope = service === 'any' ? SERVICES : [service];
  return scope.some((one) => pattern.test(sources[one] ?? ''));
}

type SourceText = Readonly<Record<Service, string>>;

/**
 * Every disagreement between the doc's table and the code: a documented consumer the code does
 * not build, a marked one the code has already built, a code consumer the doc does not name, and
 * the same both ways for whether each subject is actually published.
 */
export function checkEventTopology(
  doc: readonly DocSubject[],
  consumers: readonly CodeConsumer[],
  sources: SourceText,
): string[] {
  const problems: string[] = [];
  const bySubject = new Map(doc.map((row) => [row.subject, row]));

  for (const row of doc) {
    const constant = subjectConst(row.subject);
    const published = publishedBy(row.publisher, constant, sources);
    if (row.notPublishedYet && published) {
      problems.push(`${row.subject}: marked not published yet, but the code publishes it`);
    } else if (!row.notPublishedYet && !published) {
      problems.push(
        `${row.subject}: documented as published by ${row.publisher}, but no outbox.add found`,
      );
    }

    for (const { service, marked } of row.consumers) {
      const built = consumers.some((c) => c.service === service && c.subjectConst === constant);
      if (marked && built) {
        problems.push(`${row.subject}: ${service} is marked not built, but consumes it`);
      } else if (!marked && !built) {
        problems.push(`${row.subject}: ${service} is documented as a consumer, but builds none`);
      }
    }
  }

  for (const consumer of consumers) {
    const row = [...bySubject.values()].find(
      (r) => subjectConst(r.subject) === consumer.subjectConst,
    );
    if (row === undefined) {
      problems.push(
        `${consumer.subjectConst}: ${consumer.service} consumes an undeclared subject (${consumer.file})`,
      );
      continue;
    }
    if (!row.consumers.some((c) => c.service === consumer.service)) {
      problems.push(
        `${row.subject}: ${consumer.service} consumes it, but the doc names no such consumer`,
      );
    }
  }

  return problems;
}

/**
 * Audit actions, notification types and email templates with no producer under any service's
 * `src` (excluding tests) — every one is Phase 3. The guard fails the day one is produced without
 * being dropped here, or a new one appears on neither side.
 */
export const PHASE_3_OWED = {
  auditActions: new Set([
    'TOUR_CREATED',
    'TOUR_UPDATED',
    'TOUR_STOPS_REPLACED',
    'TOUR_ACTIVATED',
    'TOUR_DEACTIVATED',
    'TOUR_DELETED',
    'TOUR_RESTORED',
    'BOOSTS_UPDATED',
    'PAYOUT_ACCOUNT_CREATED',
    'VOUCHER_OFFER_CREATED',
    'VOUCHER_OFFER_UPDATED',
    'VOUCHER_OFFER_SUBMITTED',
    'VOUCHER_OFFER_PAUSED',
    'VOUCHER_OFFER_ARCHIVED',
    'VOUCHER_OFFER_APPROVED',
    'VOUCHER_OFFER_REJECTED',
    'VOUCHER_REDEEMED',
    'VOUCHER_REISSUED',
    'STAFF_INVITED',
    'STAFF_INVITATION_ACCEPTED',
    'STAFF_SCOPE_UPDATED',
    'STAFF_REVOKED',
    'REFUND_CREATED',
    'ORDER_PAID',
    'ORDER_REFUNDED',
    'DISPUTE_OPENED',
  ]),
  notificationTypes: new Set([
    'VOUCHER_OFFER_APPROVED',
    'VOUCHER_OFFER_REJECTED',
    'VOUCHER_SOLD',
    'VOUCHER_CODE_GUESSING_SUSPECTED',
    'PAYOUT_ACCOUNT_ACTION_REQUIRED',
  ]),
  emailTemplates: new Set(['STAFF_INVITE', 'VOUCHER_MOVED', 'VOUCHER_REFUNDED']),
} as const;

/** Every disagreement between a vocabulary's members and what the code actually produces. */
export function checkVocabulary(
  label: string,
  members: readonly string[],
  enumName: string,
  owed: ReadonlySet<string>,
  allSources: string,
): string[] {
  const problems: string[] = [];
  for (const member of members) {
    const produced = new RegExp(`${enumName}\\.${member}\\b`).test(allSources);
    if (produced && owed.has(member)) {
      problems.push(`${label}: ${member} is produced now — drop it from PHASE_3_OWED`);
    } else if (!produced && !owed.has(member)) {
      problems.push(`${label}: ${member} is neither produced nor in PHASE_3_OWED`);
    }
  }
  return problems;
}

function readAll(paths: readonly string[]): { path: string; text: string }[] {
  return paths.map((path) => ({ path, text: readRepoFile(path) }));
}

function serviceSources(): SourceText {
  const sources = {} as Record<Service, string>;
  for (const service of SERVICES) {
    sources[service] = readAll(listFiles(`services/${service}/src/**/*.ts`))
      .filter(({ path }) => !path.endsWith('.spec.ts'))
      .map(({ text }) => text)
      .join('\n');
  }
  return sources;
}

describe('event topology', () => {
  it('holds between api-endpoints-plan §10 and the code', () => {
    const doc = extractEventTopology(readRepoFile('docs/api-endpoints-plan.md'));
    const consumerFiles = readAll(listFiles('services/*/src/**/*.consumer.ts'));
    const consumers = extractConsumers(consumerFiles);
    const sources = serviceSources();
    expect(checkEventTopology(doc, consumers, sources)).toEqual([]);
  });

  it('extracts enough of the real table to mean something', () => {
    const doc = extractEventTopology(readRepoFile('docs/api-endpoints-plan.md'));
    expect(doc.length).toBeGreaterThanOrEqual(24);
    expect(doc.find((row) => row.subject === 'identity.device.claimed')?.consumers).toEqual([
      { service: 'catalog', marked: false },
    ]);
  });

  it('holds the vocabulary both ways', () => {
    const sources = Object.values(serviceSources()).join('\n');
    const problems = [
      ...checkVocabulary(
        'audit actions',
        AUDIT_ACTIONS,
        'AuditAction',
        PHASE_3_OWED.auditActions,
        sources,
      ),
      ...checkVocabulary(
        'notification types',
        NOTIFICATION_TYPES,
        'NotificationType',
        PHASE_3_OWED.notificationTypes,
        sources,
      ),
      ...checkVocabulary(
        'email templates',
        EMAIL_TEMPLATES,
        'EmailTemplate',
        PHASE_3_OWED.emailTemplates,
        sources,
      ),
    ];
    expect(problems).toEqual([]);
  });

  it('reports every kind of drift', () => {
    const doc: DocSubject[] = [
      {
        subject: 'thing.item.made',
        publisher: 'catalog',
        notPublishedYet: false,
        consumers: [{ service: 'identity', marked: false }],
      },
      {
        subject: 'thing.item.retired',
        publisher: 'billing',
        notPublishedYet: true,
        consumers: [{ service: 'identity', marked: true }],
      },
    ];
    const sources: SourceText = {
      identity: `class ThingConsumer { readonly event = THING_ITEM_MADE; }`,
      catalog: `outbox.add(tx, THING_ITEM_MADE, {})`,
      narration: '',
      billing: '',
      ai: '',
    };
    const consumers: CodeConsumer[] = [
      {
        file: 'services/identity/src/thing.consumer.ts',
        service: 'identity',
        subjectConst: 'THING_ITEM_MADE',
      },
    ];

    // Conforming: no complaints.
    expect(checkEventTopology(doc, consumers, sources)).toEqual([]);

    // A documented consumer the code does not build.
    expect(checkEventTopology(doc, [], sources).join('\n')).toMatch(
      /thing\.item\.made: identity is documented as a consumer, but builds none/,
    );

    // A consumer marked not built, but the code has built it anyway.
    const builtEarly: CodeConsumer[] = [
      ...consumers,
      {
        file: 'services/identity/src/retired.consumer.ts',
        service: 'identity',
        subjectConst: 'THING_ITEM_RETIRED',
      },
    ];
    expect(checkEventTopology(doc, builtEarly, sources).join('\n')).toMatch(
      /thing\.item\.retired: identity is marked not built, but consumes it/,
    );

    // A subject the code consumes that the doc never declares.
    const undeclared: CodeConsumer[] = [
      {
        file: 'services/catalog/src/mystery.consumer.ts',
        service: 'catalog',
        subjectConst: 'THING_MYSTERIOUS',
      },
    ];
    expect(checkEventTopology(doc, undeclared, sources).join('\n')).toMatch(
      /THING_MYSTERIOUS: catalog consumes an undeclared subject/,
    );

    // An audit action neither produced nor listed as owed.
    expect(
      checkVocabulary('audit actions', ['NOT_REAL'], 'AuditAction', new Set(), '').join('\n'),
    ).toMatch(/audit actions: NOT_REAL is neither produced nor in PHASE_3_OWED/);
  });
});
