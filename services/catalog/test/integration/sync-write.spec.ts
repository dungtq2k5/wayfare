import { newId } from '@wayfare/contracts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { bumpSyncVersion, withSyncWrite } from '../../src/modules/sync/sync.service';
import { testPrisma, truncateAll } from '../setup/database';
import { errorOf, insertPlace, taxonomy } from '../setup/fixtures';

const prisma = testPrisma();

beforeEach(() => truncateAll(prisma));
afterAll(() => prisma.$disconnect());

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('withSyncWrite', () => {
  it('sets the server timeout as the first statement', async () => {
    const setting = await withSyncWrite(prisma, async (tx) => {
      const [row] = await tx.$queryRaw<{ transaction_timeout: string }[]>`SHOW transaction_timeout`;
      return row!.transaction_timeout;
    });
    expect(setting).toBe('4s');
  });

  it('answers 503 when the server ends an overlong transaction', async () => {
    const failure = await errorOf(
      withSyncWrite(
        prisma,
        async (tx) => {
          await sleep(4_500);
          await tx.$queryRaw`SELECT 1`;
        },
        { clientTimeoutMs: 10_000 },
      ),
    );
    expect(failure.code).toBe('UPSTREAM_UNAVAILABLE');
    // The pool recovers.
    await expect(prisma.$queryRaw`SELECT 1`).resolves.toBeDefined();
  }, 20_000);

  it('answers 503 when its own lower timeout ends it first', async () => {
    const failure = await errorOf(
      withSyncWrite(
        prisma,
        async (tx) => {
          await sleep(600);
          await tx.$queryRaw`SELECT 1`;
        },
        { clientTimeoutMs: 300 },
      ),
    );
    expect(failure.code).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('rethrows any other error untouched', async () => {
    await expect(withSyncWrite(prisma, () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );
  });
});

describe('bumpSyncVersion', () => {
  it('takes a fresh, higher version and stamps updated_at', async () => {
    const { area, any } = await taxonomy(prisma);
    const { id } = await insertPlace(prisma, { areaId: area.id, categoryId: any.id });
    const before = await prisma.place.findUniqueOrThrow({ where: { id } });
    const version = await withSyncWrite(prisma, (tx) => bumpSyncVersion(tx, id));
    const after = await prisma.place.findUniqueOrThrow({ where: { id } });
    expect(version).toBeGreaterThan(before.syncVersion);
    expect(after.syncVersion).toBe(version);
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
  });

  it('fails for an unknown Place', async () => {
    await expect(withSyncWrite(prisma, (tx) => bumpSyncVersion(tx, newId()))).rejects.toThrow(
      /no Place/,
    );
  });
});
