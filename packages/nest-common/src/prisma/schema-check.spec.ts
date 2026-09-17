import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { createSchemaCheck } from './schema-check';
import type { PrismaQueryable } from './schema-check';

class FakePrisma implements PrismaQueryable {
  constructor(private readonly applied: string[]) {}
  $queryRawUnsafe<T>(sql: string): Promise<T> {
    if (sql.includes('to_regclass')) return Promise.resolve([{ name: '_prisma_migrations' }] as T);
    if (sql.includes('_prisma_migrations'))
      return Promise.resolve(this.applied.map((name) => ({ name })) as T);
    return Promise.resolve([{ name: 'present_idx' }] as T);
  }
}

function fixture(expectedIndexes: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'schema-check-'));
  mkdirSync(join(dir, 'migrations', '20260101000000_init'), { recursive: true });
  writeFileSync(join(dir, 'expected.json'), JSON.stringify({ indexes: expectedIndexes }));
  return {
    migrationsDir: join(dir, 'migrations'),
    expectedObjectsPath: join(dir, 'expected.json'),
  };
}

async function boot(applied: string[], expectedIndexes: string[]) {
  const module = await Test.createTestingModule({
    providers: [
      { provide: FakePrisma, useValue: new FakePrisma(applied) },
      ...createSchemaCheck({
        service: 'demo',
        prismaToken: FakePrisma,
        ...fixture(expectedIndexes),
      }),
    ],
  }).compile();
  await module.init();
  await module.close();
}

describe('createSchemaCheck', () => {
  it('boots when every migration and object is present', async () => {
    await expect(boot(['20260101000000_init'], ['present_idx'])).resolves.toBeUndefined();
  });

  it('refuses to boot, naming what is missing', async () => {
    await expect(boot([], ['present_idx', 'absent_idx'])).rejects.toThrow(
      'Schema not ready for demo: migration "20260101000000_init" not applied; index "absent_idx"',
    );
  });
});
