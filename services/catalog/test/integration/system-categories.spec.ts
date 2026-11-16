// The category registry (rdm-spec C-2): inserted insert-only, never overriding an admin's change.
import { SYSTEM_CATEGORIES } from '@wayfare/contracts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { syncSystemCategories } from '../../src/modules/system-catalog/system-catalog.service';
import { testPrisma, truncateAll } from '../setup/database';

const prisma = testPrisma();

beforeEach(() => truncateAll(prisma));
afterAll(async () => {
  await truncateAll(prisma);
  await prisma.$disconnect();
});

describe('syncSystemCategories', () => {
  it('fills an empty table with the registry', async () => {
    await prisma.category.deleteMany();
    expect(await syncSystemCategories(prisma)).toBe(SYSTEM_CATEGORIES.length);
    const rows = await prisma.category.findMany({ orderBy: { sortOrder: 'asc' } });
    expect(
      rows.map((row) => [row.code, row.appliesTo, row.icon, row.sortOrder, row.isActive]),
    ).toEqual(
      SYSTEM_CATEGORIES.map((entry) => [
        entry.code,
        entry.appliesTo,
        entry.icon,
        entry.sortOrder,
        true,
      ]),
    );
  });

  it("leaves an admin's change alone, and inserts nothing twice", async () => {
    await prisma.category.update({ where: { code: 'MARKET' }, data: { icon: 'basket' } });
    await prisma.category.update({ where: { code: 'PARK' }, data: { isActive: false } });
    expect(await syncSystemCategories(prisma)).toBe(0);
    expect((await prisma.category.findUniqueOrThrow({ where: { code: 'MARKET' } })).icon).toBe(
      'basket',
    );
    expect((await prisma.category.findUniqueOrThrow({ where: { code: 'PARK' } })).isActive).toBe(
      false,
    );
    expect(await prisma.category.count()).toBe(SYSTEM_CATEGORIES.length);
  });

  it('truncation removes a test category and resets the system rows', async () => {
    await prisma.category.create({ data: { code: 'TEST_X', appliesTo: 'ANY', icon: 'pin' } });
    await prisma.category.update({ where: { code: 'CAFE' }, data: { isActive: false, icon: 'x' } });
    await truncateAll(prisma);
    expect(await prisma.category.findUnique({ where: { code: 'TEST_X' } })).toBeNull();
    expect(await prisma.category.findUniqueOrThrow({ where: { code: 'CAFE' } })).toMatchObject({
      isActive: true,
      icon: 'cafe',
    });
  });
});
