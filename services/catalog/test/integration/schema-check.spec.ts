// The boot check against the real test database (conventions §8.1): it reads, never writes.
import { mkdtempSync, readFileSync, writeFileSync, cpSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { snapshotProcessEnv } from '@wayfare/nest-common/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { testEnv } from '../setup/database';

const ROOT = resolve(__dirname, '../..');
let restoreEnv: (() => void) | undefined;

afterEach(() => restoreEnv?.());

async function boot(schema: { migrationsDir?: string; expectedObjectsPath?: string }) {
  restoreEnv = snapshotProcessEnv();
  const module = await Test.createTestingModule({
    imports: [AppModule.forRoot({ env: testEnv(), jobs: false, schema })],
  }).compile();
  try {
    await module.init();
  } finally {
    await module.close();
  }
}

describe('SchemaCheck', () => {
  it('boots on the deployed test database', async () => {
    await expect(boot({})).resolves.toBeUndefined();
  });

  it('refuses to boot, naming an unapplied migration and a missing index', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'catalog-schema-'));
    const migrations = join(dir, 'migrations');
    cpSync(join(ROOT, 'prisma/migrations'), migrations, { recursive: true });
    mkdirSync(join(migrations, '29990101000000_not_yet'));
    const expected = JSON.parse(
      readFileSync(join(ROOT, 'prisma/sql/expected-objects.json'), 'utf8'),
    ) as { indexes: string[] };
    const expectedPath = join(dir, 'expected-objects.json');
    writeFileSync(
      expectedPath,
      JSON.stringify({ ...expected, indexes: [...expected.indexes, 'places_imaginary_idx'] }),
    );
    await expect(
      boot({ migrationsDir: migrations, expectedObjectsPath: expectedPath }),
    ).rejects.toThrow(
      /Schema not ready for catalog: .*migration "29990101000000_not_yet" not applied.*index "places_imaginary_idx"/,
    );
  });
});
