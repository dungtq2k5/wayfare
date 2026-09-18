// Guard: each service's env schema, its .env.example and architecture §14 list the same variables
// (conventions §13, §17.4).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { compareStrings } from '@wayfare/contracts';
import { listFiles, readRepoFile, REPO_ROOT } from './support/repo';

/**
 * Keys a service's `.env.example` lists but its schema does not parse, with the file that reads
 * them. A path starting with `./` is relative to the service directory; any other path is
 * relative to the repo root. The named file must spell the key.
 */
const READ_ELSEWHERE: Readonly<Record<string, string>> = {
  DATABASE_URL_TEST: './prisma.config.ts',
  DATABASE_URL_SHADOW: './prisma.config.ts',
  NATS_URL_TEST: './test/setup/env.ts',
  BOOTSTRAP_SUPER_ADMIN_EMAIL: './src/scripts/bootstrap-super-admin.ts',
  BOOTSTRAP_SUPER_ADMIN_PASSWORD: './src/scripts/bootstrap-super-admin.ts',
  SEED_ACCOUNT_PASSWORD: './prisma/seed/dev-accounts.seed.ts',
  RESEND_ADMIN_API_KEY: './src/scripts/email-check-domain.ts',
  RESEND_DOMAIN_ID: './src/scripts/email-check-domain.ts',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'packages/nest-common/src/observability/instrumentation.ts',
  OTEL_TRACES_SAMPLER: 'packages/nest-common/src/observability/instrumentation.ts',
  OTEL_SERVICE_NAME: 'packages/nest-common/src/observability/instrumentation.ts',
};

const SECRET_KEY = /KEY|SECRET|TOKEN|PASSWORD/;

/** The variable names architecture §14 declares: exact names, a `<PEER>` pattern, and `X_*` prefixes. */
export interface SpecNames {
  readonly exact: ReadonlySet<string>;
  readonly patterns: readonly RegExp[];
}

/** Parses the first column of architecture §14's table. */
export function parseSpecNames(architecture: string): SpecNames {
  const start = architecture.search(/^## 14\. /m);
  if (start < 0) throw new Error('architecture §14 not found');
  const end = architecture.slice(start + 1).search(/^## /m);
  const section = end < 0 ? architecture.slice(start) : architecture.slice(start, start + 1 + end);
  const exact = new Set<string>();
  const patterns: RegExp[] = [];
  for (const line of section.split('\n')) {
    if (!line.startsWith('|') || /^\|\s*:?-/.test(line)) continue;
    const cell = line.split('|')[1] ?? '';
    for (const [, name] of cell.matchAll(/`([^`]+)`/g)) {
      if (name!.startsWith('…')) continue; // continues the name before it: `STRIPE_PRICE_GROWTH_MONTHLY`, `…_ANNUAL`
      if (name === '<PEER>_GRPC_URL') patterns.push(/^[A-Z]+_GRPC_URL$/);
      else if (name!.endsWith('_*')) patterns.push(new RegExp(`^${name!.slice(0, -1)}`));
      else exact.add(name!);
    }
  }
  return { exact, patterns };
}

function isDeclared(key: string, spec: SpecNames): boolean {
  return spec.exact.has(key) || spec.patterns.some((pattern) => pattern.test(key));
}

/** The keys of an env schema — which must still be a plain object schema. */
export function schemaKeysOf(schema: unknown): string[] | null {
  // `_zod.def.type`, not `instanceof`: the service's zod and this guard's may be separate copies.
  const def = (schema as { _zod?: { def?: { type?: string } } } | null)?._zod?.def;
  if (def?.type !== 'object') return null;
  return Object.keys((schema as { shape: Record<string, unknown> }).shape);
}

/** Parses `KEY=value` lines. */
export function exampleEntries(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of text.split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match) entries.set(match[1]!, match[2]!);
  }
  return entries;
}

/** One service's inputs to the contract check. */
export interface ServiceEnv {
  readonly service: string;
  readonly schema: unknown;
  readonly example: string;
}

/** Every contract problem across the services. `readFile` returns null for a missing file. */
export function checkEnvContract(
  services: readonly ServiceEnv[],
  spec: SpecNames,
  readFile: (path: string) => string | null,
): string[] {
  const problems: string[] = [];
  const listed = new Set<string>();

  for (const { service, schema, example } of services) {
    const where = `services/${service}`;
    const keys = schemaKeysOf(schema);
    if (keys === null) {
      problems.push(
        `${where}: envSchema is not a plain object schema (a .transform() or .pipe() hides its keys)`,
      );
      continue;
    }
    const entries = exampleEntries(example);
    for (const key of keys) {
      if (!entries.has(key))
        problems.push(`${where}: ${key} is in the schema but not in .env.example`);
    }
    for (const [key, value] of entries) {
      listed.add(key);
      if (!keys.includes(key) && !(key in READ_ELSEWHERE)) {
        problems.push(
          `${where}: ${key} is in .env.example but neither the schema nor READ_ELSEWHERE reads it`,
        );
      }
      if (SECRET_KEY.test(key) && value !== '')
        problems.push(`${where}: ${key} has a value in .env.example — secrets never do`);
      const reader = READ_ELSEWHERE[key];
      if (reader !== undefined && !keys.includes(key)) {
        const path = reader.startsWith('./') ? `${where}/${reader.slice(2)}` : reader;
        const text = readFile(path);
        if (text === null)
          problems.push(`${where}: READ_ELSEWHERE names ${path} for ${key}, which does not exist`);
        else if (!text.includes(key))
          problems.push(
            `${where}: READ_ELSEWHERE says ${path} reads ${key}, but it never names it`,
          );
      }
    }
    for (const key of new Set([...keys, ...entries.keys()])) {
      if (!isDeclared(key, spec))
        problems.push(`${where}: ${key} is not listed in architecture §14`);
    }
  }
  for (const key of Object.keys(READ_ELSEWHERE)) {
    if (!listed.has(key))
      problems.push(`READ_ELSEWHERE: ${key} is in no .env.example — a stale exemption`);
  }
  return problems;
}

function repoFile(path: string): string | null {
  return existsSync(join(REPO_ROOT, path)) ? readRepoFile(path) : null;
}

async function loadServices(): Promise<ServiceEnv[]> {
  const schemas = listFiles('services/*/src/config/env.schema.ts').toSorted(compareStrings);
  return Promise.all(
    schemas.map(async (path) => {
      const service = path.split('/')[1]!;
      const module = (await import(join(REPO_ROOT, path))) as { envSchema?: unknown };
      return {
        service,
        schema: module.envSchema,
        example: repoFile(`services/${service}/.env.example`) ?? '',
      };
    }),
  );
}

// ── Synthetic fixtures ─────────────────────────────────────────────────────────

const SPEC = parseSpecNames(
  [
    '## 14. Environment variables',
    '',
    '| Variable | Used by | Notes |',
    '| :---- | :---- | :---- |',
    '| `DATABASE_URL` | each | x |',
    '| `DATABASE_URL_TEST` | each | x |',
    '| `NATS_URL_TEST` | tests | x |',
    '| `STRIPE_SECRET_KEY` | billing | x |',
    '| `STRIPE_PRICE_GROWTH_MONTHLY`, `…_ANNUAL`, `…_PRO_*` | billing | x |',
    '| `<PEER>_GRPC_URL` | callers | x |',
    '| `PROXYPAL_*` | ai | x |',
    '| `OTEL_EXPORTER_OTLP_ENDPOINT` | all | x |',
    '| `OTEL_TRACES_SAMPLER` | all | x |',
    '| `OTEL_SERVICE_NAME` | all | x |',
    '| `DATABASE_URL_SHADOW` | each | x |',
    '| `BOOTSTRAP_SUPER_ADMIN_EMAIL`, `BOOTSTRAP_SUPER_ADMIN_PASSWORD` | a script | x |',
    '| `RESEND_ADMIN_API_KEY`, `RESEND_DOMAIN_ID` | a script | x |',
    '| `SEED_ACCOUNT_PASSWORD` | a seed | x |',
    '',
    '## 15. Next',
    '| `NOT_IN_SECTION` | x | x |',
  ].join('\n'),
);

const FILES: Record<string, string> = {
  'services/svc/prisma.config.ts': "env('DATABASE_URL_TEST'); env('DATABASE_URL_SHADOW')",
  'services/svc/test/setup/env.ts': 'process.env.NATS_URL_TEST',
  'services/svc/src/scripts/bootstrap-super-admin.ts':
    'BOOTSTRAP_SUPER_ADMIN_EMAIL, BOOTSTRAP_SUPER_ADMIN_PASSWORD',
  'services/svc/src/scripts/email-check-domain.ts': 'RESEND_ADMIN_API_KEY, RESEND_DOMAIN_ID',
  'services/svc/prisma/seed/dev-accounts.seed.ts': 'SEED_ACCOUNT_PASSWORD',
  'packages/nest-common/src/observability/instrumentation.ts':
    'OTEL_SERVICE_NAME, OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_TRACES_SAMPLER',
};
const readFixture = (path: string): string | null => FILES[path] ?? null;

const COMPLETE_EXAMPLE = [
  'DATABASE_URL=postgresql://x',
  'DATABASE_URL_TEST=postgresql://x',
  'DATABASE_URL_SHADOW=postgresql://x',
  'NATS_URL_TEST=nats://x',
  'BOOTSTRAP_SUPER_ADMIN_EMAIL=',
  'BOOTSTRAP_SUPER_ADMIN_PASSWORD=',
  'RESEND_ADMIN_API_KEY=',
  'RESEND_DOMAIN_ID=',
  'SEED_ACCOUNT_PASSWORD=',
  'OTEL_EXPORTER_OTLP_ENDPOINT=http://x',
  'OTEL_TRACES_SAMPLER=always_on',
  'OTEL_SERVICE_NAME=svc',
].join('\n');

const schema = z.object({ DATABASE_URL: z.url() });
const service = (overrides: Partial<ServiceEnv> = {}): ServiceEnv => ({
  service: 'svc',
  schema,
  example: COMPLETE_EXAMPLE,
  ...overrides,
});

describe('env contract', () => {
  it('holds for every service', async () => {
    const spec = parseSpecNames(readRepoFile('docs/architecture-and-tech-stack.md'));
    expect(checkEnvContract(await loadServices(), spec, repoFile)).toEqual([]);
  });

  it('accepts a complete fixture', () => {
    expect(checkEnvContract([service()], SPEC, readFixture)).toEqual([]);
  });

  it('reports every kind of violation', () => {
    const cases: [string, ServiceEnv[], Record<string, string>, RegExp][] = [
      [
        'schema key missing from the example',
        [service({ schema: z.object({ DATABASE_URL: z.url(), GRPC_URL: z.string() }) })],
        FILES,
        /GRPC_URL is in the schema but not in \.env\.example/,
      ],
      [
        'example key read by nobody',
        [service({ example: `${COMPLETE_EXAMPLE}\nLOST_VAR=1` })],
        FILES,
        /LOST_VAR is in \.env\.example but neither/,
      ],
      [
        'key missing from §14',
        [
          service({
            schema: z.object({ DATABASE_URL: z.url(), MYSTERY: z.string() }),
            example: `${COMPLETE_EXAMPLE}\nMYSTERY=1`,
          }),
        ],
        FILES,
        /MYSTERY is not listed in architecture §14/,
      ],
      [
        'exemption whose reader never names the key',
        [service()],
        { ...FILES, 'services/svc/test/setup/env.ts': 'nothing here' },
        /never names it/,
      ],
      [
        'exemption listed by no example',
        [service({ example: COMPLETE_EXAMPLE.replace('NATS_URL_TEST=nats://x\n', '') })],
        FILES,
        /NATS_URL_TEST is in no \.env\.example/,
      ],
      [
        'a secret with a value',
        [
          service({
            schema: z.object({ DATABASE_URL: z.url(), STRIPE_SECRET_KEY: z.string() }),
            example: `${COMPLETE_EXAMPLE}\nSTRIPE_SECRET_KEY=sk_live_x`,
          }),
        ],
        FILES,
        /STRIPE_SECRET_KEY has a value/,
      ],
      [
        'a schema that hides its keys',
        [service({ schema: schema.transform((env) => env) })],
        FILES,
        /not a plain object schema/,
      ],
    ];
    for (const [label, services, files, expected] of cases) {
      expect(
        checkEnvContract(services, SPEC, (path) => files[path] ?? null).join('\n'),
        label,
      ).toMatch(expected);
    }
  });

  it('parses the §14 name forms', () => {
    expect(SPEC.exact.has('STRIPE_PRICE_GROWTH_MONTHLY')).toBe(true);
    expect([...SPEC.exact].some((name) => name.startsWith('…'))).toBe(false);
    expect(isDeclared('PROXYPAL_URL', SPEC)).toBe(true);
    expect(isDeclared('IDENTITY_GRPC_URL', SPEC)).toBe(true);
    expect(isDeclared('NOT_IN_SECTION', SPEC)).toBe(false);
    expect(schemaKeysOf(z.object({ A: z.string() }).refine(() => true))).toEqual(['A']);
  });

  it('checks the real services', async () => {
    const services = await loadServices();
    expect(services.map((entry) => entry.service)).toEqual(
      expect.arrayContaining(['gateway', 'identity']),
    );
    for (const entry of services)
      expect(schemaKeysOf(entry.schema)?.length ?? 0, entry.service).toBeGreaterThanOrEqual(5);
  });
});
