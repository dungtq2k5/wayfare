// Guard: every file under services/*/src/modules/ has a known role for its kind of service, with the
// matching class name (conventions §2.1, §2.2, §15, §17.4). No repository layer (ADR 0054).
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { listFiles, pascalCase, readRepoFile } from './support/repo';

const KEBAB = '[a-z0-9]+(?:-[a-z0-9]+)*';
const MODULE_FILE = new RegExp(`^services/([a-z0-9-]+)/src/modules/(${KEBAB})/(.+)$`);

type ServiceKind = 'gateway' | 'backend';

interface FileFacts {
  readonly classes: readonly string[];
  readonly imports: readonly string[];
}

function factsOf(file: string, text: string): FileFacts {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const classes: string[] = [];
  const imports: string[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      imports.push(statement.moduleSpecifier.text);
    }
    const exported =
      ts.canHaveModifiers(statement) &&
      (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (exported && ts.isClassDeclaration(statement))
      classes.push(statement.name?.text ?? '(anonymous)');
  }
  return { classes, imports };
}

function exactlyOne(file: string, classes: readonly string[], expected: string): string[] {
  return classes.length === 1 && classes[0] === expected
    ? []
    : [
        `${file}: must export exactly one class, ${expected} (found ${classes.join(', ') || 'none'})`,
      ];
}

/** Every role problem for one file under `modules/`. */
export function checkModuleFile(file: string, text: string): string[] {
  const match = MODULE_FILE.exec(file);
  if (!match) return [`${file}: not under services/<service>/src/modules/<module>/`];
  const [, service, module, rest] = match as unknown as [string, string, string, string];
  const kind: ServiceKind = service === 'gateway' ? 'gateway' : 'backend';
  const onlyIn = (allowed: ServiceKind, role: string): string[] =>
    kind === allowed
      ? []
      : [
          `${file}: a ${role} belongs in ${allowed === 'gateway' ? 'the gateway' : 'a backend service'}`,
        ];

  if (/\.repository\.ts$/.test(rest)) {
    return [`${file}: services query Prisma directly — no repository layer (ADR 0054)`];
  }

  // A unit test sits beside a file with a known role; only its name is checked.
  const isSpec = rest.endsWith('.spec.ts');
  const target = isSpec ? rest.replace(/\.spec\.ts$/, '.ts') : rest;
  const facts = isSpec ? { classes: [], imports: [] } : factsOf(file, text);
  const roleOnly = (problems: string[]): string[] => (isSpec ? [] : problems);

  if (new RegExp(`^dto/${KEBAB}\\.dto\\.ts$`).test(target)) return onlyIn('gateway', 'DTO'); // names: dto-naming guard

  if (new RegExp(`^domain/${KEBAB}\\.ts$`).test(target)) {
    const problems = onlyIn('backend', 'domain rule');
    if (facts.classes.length > 0)
      problems.push(`${file}: a domain rule exports functions, types and constants — no class`);
    for (const specifier of facts.imports) {
      if (
        specifier.startsWith('@nestjs/') ||
        /(^|\/)generated\/prisma(\/|$)/.test(specifier) ||
        specifier === '@prisma/client'
      ) {
        problems.push(
          `${file}: a domain rule has no I/O and imports nothing from Nest or Prisma (${specifier})`,
        );
      }
    }
    return problems;
  }

  if (target.includes('/'))
    return [`${file}: only dto/ and domain/ may hold files below a module directory`];

  const stem = (suffix: string): string | null => {
    const found = new RegExp(`^(${KEBAB})${suffix.replaceAll('.', '\\.')}$`).exec(target);
    return found ? found[1]! : null;
  };

  const moduleStem = stem('.module.ts');
  if (moduleStem !== null) {
    const modules = facts.classes.filter((name) => name.endsWith('Module'));
    return roleOnly(
      modules.length === 1
        ? []
        : [
            `${file}: must export exactly one …Module class (found ${modules.join(', ') || 'none'})`,
          ],
    );
  }

  const serviceStem = stem('.service.ts');
  if (serviceStem !== null) {
    if (serviceStem !== module && serviceStem !== 'prisma') {
      return [`${file}: a service file is named after its module: ${module}.service.ts`];
    }
    return roleOnly(exactlyOne(file, facts.classes, `${pascalCase(serviceStem)}Service`));
  }

  if (stem('.mapper.ts') !== null) {
    return roleOnly(facts.classes.length === 0 ? [] : [`${file}: a mapper exports no class`]);
  }

  const grpcControllerStem = stem('-grpc.controller.ts');
  if (grpcControllerStem !== null) {
    if (kind !== 'backend') return onlyIn('backend', 'gRPC controller');
    if (grpcControllerStem !== module)
      return [`${file}: a gRPC controller is named ${module}-grpc.controller.ts`];
    return roleOnly(exactlyOne(file, facts.classes, `${pascalCase(module)}GrpcController`));
  }

  // A peer client: the gateway's, or a backend service's for an internal RPC (api-endpoints-plan §12.2).
  const clientStem = stem('-service-grpc.client.ts');
  if (clientStem !== null) {
    return roleOnly(exactlyOne(file, facts.classes, `${pascalCase(clientStem)}ServiceGrpcClient`));
  }

  const controllerStem = stem('.controller.ts');
  if (controllerStem !== null) {
    if (kind !== 'gateway') return onlyIn('gateway', 'HTTP controller');
    if (controllerStem !== module)
      return [`${file}: an HTTP controller is named ${module}.controller.ts`];
    return roleOnly(exactlyOne(file, facts.classes, `${pascalCase(module)}Controller`));
  }

  // The gateway's socket entry point (api-endpoints-plan §9, ADR 0020).
  const socketStem = stem('.gateway.ts');
  if (socketStem !== null) {
    if (kind !== 'gateway') return onlyIn('gateway', 'socket gateway');
    if (socketStem !== module) return [`${file}: a socket gateway is named ${module}.gateway.ts`];
    return roleOnly(exactlyOne(file, facts.classes, `${pascalCase(module)}Gateway`));
  }

  const consumerStem = stem('.consumer.ts');
  if (consumerStem !== null) {
    if (kind !== 'backend') return onlyIn('backend', 'consumer');
    if (consumerStem !== module) return [`${file}: a consumer is named ${module}.consumer.ts`];
    return roleOnly(exactlyOne(file, facts.classes, `${pascalCase(module)}Consumer`));
  }

  const jobStem = new RegExp(`^([a-z0-9]+(?:-[a-z0-9]+)+)\\.job\\.ts$`).exec(target)?.[1];
  if (jobStem !== undefined) {
    if (kind !== 'backend') return onlyIn('backend', 'scheduled job');
    return roleOnly(exactlyOne(file, facts.classes, `${pascalCase(jobStem)}Job`));
  }

  return [`${file}: no known role — see conventions §15 for the file names a module may hold`];
}

function corpus(): string[] {
  return listFiles('services/*/src/modules/**');
}

describe('module files', () => {
  it('each have a known role', () => {
    expect(corpus().flatMap((file) => checkModuleFile(file, readRepoFile(file)))).toEqual([]);
  });

  it('reports every kind of violation', () => {
    const backend = 'services/catalog/src/modules/places';
    const gateway = 'services/gateway/src/modules/places';
    const cases: [string, string, string, RegExp][] = [
      ['a repository', `${backend}/places.repository.ts`, '', /ADR 0054/],
      [
        'an HTTP controller in a backend',
        `${backend}/places.controller.ts`,
        'export class PlacesController {}',
        /belongs in the gateway/,
      ],
      [
        'a gRPC controller in the gateway',
        `${gateway}/places-grpc.controller.ts`,
        'export class PlacesGrpcController {}',
        /belongs in a backend/,
      ],
      ['a helpers file', `${backend}/helpers.ts`, '', /no known role/],
      [
        'a misnamed gRPC controller class',
        'services/identity/src/modules/devices/devices-grpc.controller.ts',
        'export class DeviceController {}',
        /DevicesGrpcController/,
      ],
      [
        'two Module classes',
        `${backend}/places.module.ts`,
        'export class PlacesModule {}\nexport class OtherModule {}',
        /exactly one …Module/,
      ],
      [
        'a .sweep.ts job',
        `${backend}/expired-boost.sweep.ts`,
        'export class ExpiredBoostSweep {}',
        /no known role/,
      ],
      [
        'a consumer named after another module',
        `${backend}/audit.consumer.ts`,
        'export class AuditConsumer {}',
        /places\.consumer\.ts/,
      ],
      [
        'a domain file exporting a class',
        `${backend}/domain/place-lifecycle.ts`,
        'export class Lifecycle {}',
        /no class/,
      ],
      [
        'a domain file importing Nest',
        `${backend}/domain/place-lifecycle.ts`,
        "import { Injectable } from '@nestjs/common';",
        /@nestjs\/common/,
      ],
      [
        'a domain file importing the Prisma client',
        `${backend}/domain/place-lifecycle.ts`,
        "import type { Place } from '../../../../generated/prisma/client';",
        /generated\/prisma/,
      ],
      [
        'a service named after another module',
        `${backend}/users.service.ts`,
        'export class UsersService {}',
        /places\.service\.ts/,
      ],
      ['a deeper file', `${backend}/utils/strings.ts`, '', /only dto\/ and domain\//],
      [
        'a socket gateway in a backend',
        `${backend}/places.gateway.ts`,
        'export class PlacesGateway {}',
        /belongs in the gateway/,
      ],
      [
        'a socket gateway named after another module',
        'services/gateway/src/modules/events/sockets.gateway.ts',
        'export class SocketsGateway {}',
        /events\.gateway\.ts/,
      ],
      ['a spec without a known source', `${backend}/helpers.spec.ts`, '', /no known role/],
    ];
    for (const [label, file, text, expected] of cases) {
      expect(checkModuleFile(file, text).join('\n'), label).toMatch(expected);
    }
  });

  it('accepts the conforming shapes', () => {
    const accepted: [string, string][] = [
      [
        'services/gateway/src/modules/ops/redis.module.ts',
        'export class RedisLifecycle {}\nexport class RedisModule {}',
      ],
      [
        'services/identity/src/modules/outbox/outbox.module.ts',
        'export class EventSpine {}\nexport class OutboxModule {}',
      ],
      ['services/identity/src/modules/prisma/prisma.service.ts', 'export class PrismaService {}'],
      [
        'services/catalog/src/modules/places/domain/place-lifecycle.ts',
        "import { PlaceStatus } from '@wayfare/contracts';\nexport function canActivate() {}",
      ],
      ['services/catalog/src/modules/places/boost-expire.job.ts', 'export class BoostExpireJob {}'],
      ['services/catalog/src/modules/places/places.consumer.ts', 'export class PlacesConsumer {}'],
      ['services/catalog/src/modules/places/domain/place-lifecycle.spec.ts', 'describe()'],
      [
        'services/gateway/src/modules/devices/identity-service-grpc.client.ts',
        'export const IDENTITY_GRPC = Symbol();\nexport class IdentityServiceGrpcClient {}',
      ],
      ['services/gateway/src/modules/devices/dto/device-response.dto.ts', ''],
      [
        'services/narration/src/modules/catalog/catalog-service-grpc.client.ts',
        'export class CatalogServiceGrpcClient {}',
      ],
      ['services/gateway/src/modules/events/events.gateway.ts', 'export class EventsGateway {}'],
    ];
    for (const [file, text] of accepted) expect(checkModuleFile(file, text), file).toEqual([]);
  });

  it('scans real modules of both service kinds', () => {
    const files = corpus();
    expect(files.length).toBeGreaterThanOrEqual(15);
    expect(files.some((file) => file.startsWith('services/gateway/'))).toBe(true);
    expect(files.some((file) => !file.startsWith('services/gateway/'))).toBe(true);
    expect(files).toContain('services/identity/src/modules/devices/devices-grpc.controller.ts');
  });
});
