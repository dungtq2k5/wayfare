import { openDatabase } from '../db/database';
import { migrate } from '../db/migrate';

/** The app's database, opened and migrated once; everything that reads or writes waits on it. */
export const databaseReady = openDatabase().then(async (db) => {
  await migrate(db);
  return db;
});
