import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit, Provider, Type } from '@nestjs/common';
import { migrationFolders, readExpectedObjects, schemaProblems } from './schema-expectations';

/** The part of a Prisma client the check needs. */
export interface PrismaQueryable {
  $queryRawUnsafe<T = unknown>(query: string): Promise<T>;
}

/** What `createSchemaCheck` is told. */
export interface SchemaCheckOptions {
  readonly service: string;
  /** Absolute: the service resolves it from its package root. */
  readonly migrationsDir: string;
  readonly expectedObjectsPath: string;
}

const SCHEMA_CHECK_OPTIONS = Symbol('SCHEMA_CHECK_OPTIONS');
const SCHEMA_CHECK_DB = Symbol('SCHEMA_CHECK_DB');

/**
 * Refuses to start a service whose database is not deployed (conventions §8.1): every migration
 * folder it ships must be finished, and every object in `expected-objects.json` present. It only
 * reads — no DDL at boot, ever. Runs in `onModuleInit`, before any bootstrap hook.
 */
@Injectable()
export class SchemaCheck implements OnModuleInit {
  private readonly logger = new Logger(SchemaCheck.name);

  constructor(
    @Inject(SCHEMA_CHECK_OPTIONS) private readonly options: SchemaCheckOptions,
    @Inject(SCHEMA_CHECK_DB) private readonly db: PrismaQueryable,
  ) {}

  async onModuleInit(): Promise<void> {
    const problems = await schemaProblems(
      (sql) => this.db.$queryRawUnsafe<{ name: string }[]>(sql),
      {
        migrations: migrationFolders(this.options.migrationsDir),
        expected: readExpectedObjects(this.options.expectedObjectsPath),
      },
    );
    if (problems.length > 0) {
      throw new Error(`Schema not ready for ${this.options.service}: ${problems.join('; ')}`);
    }
    this.logger.log('schema ready');
  }
}

/** The providers of a service's boot-time schema check. `prismaToken` is its Prisma service. */
export function createSchemaCheck(
  options: SchemaCheckOptions & { readonly prismaToken: Type<PrismaQueryable> },
): Provider[] {
  const { prismaToken, ...rest } = options;
  return [
    { provide: SCHEMA_CHECK_OPTIONS, useValue: rest },
    { provide: SCHEMA_CHECK_DB, useExisting: prismaToken },
    SchemaCheck,
  ];
}
