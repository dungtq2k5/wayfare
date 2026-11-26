import { describe, expect, it, vi } from 'vitest';

const order = vi.hoisted(() => [] as string[]);
const db = vi.hoisted(() => ({ name: 'wayfare.db' }));
vi.mock('../db/database', () => ({
  openDatabase: () => {
    order.push('open');
    return Promise.resolve(db);
  },
}));
vi.mock('../db/migrate', () => ({
  migrate: (opened: unknown) => {
    order.push(opened === db ? 'migrate' : 'migrate another');
    return Promise.resolve();
  },
}));

describe('the app’s database at launch', () => {
  it('is opened and migrated once, before anything reads it', async () => {
    const { databaseReady } = await import('./boot');
    expect(await databaseReady).toBe(db);
    expect(await databaseReady).toBe(db);
    expect(order).toEqual(['open', 'migrate']);
  });
});
