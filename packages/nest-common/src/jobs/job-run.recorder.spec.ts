import { describe, expect, it } from 'vitest';
import type { RawSqlTx } from '../prisma/helpers';
import { JobRunRecorder } from './job-run.recorder';

class FakeDb implements RawSqlTx {
  readonly statements: string[] = [];
  $queryRaw<T>(): Promise<T> {
    return Promise.resolve([] as T);
  }
  $executeRaw(query: TemplateStringsArray): Promise<number> {
    this.statements.push(query.join('?').replace(/\s+/g, ' ').trim());
    return Promise.resolve(1);
  }
}

const silentRecorder = (db: FakeDb) => {
  const recorder = new JobRunRecorder(db);
  (recorder as unknown as { logger: { error: () => void } }).logger = { error: () => undefined };
  return recorder;
};

describe('JobRunRecorder.track', () => {
  it('records the start and the success, and returns the job result', async () => {
    const db = new FakeDb();
    expect(await silentRecorder(db).track('devices-prune', () => Promise.resolve(7))).toBe(7);
    expect(db.statements[0]).toMatch(/^INSERT INTO job_runs/);
    expect(db.statements[1]).toMatch(/last_succeeded_at = \?, consecutive_failures = 0/);
  });

  it('records a failure without clearing last_succeeded_at, and rethrows', async () => {
    const db = new FakeDb();
    await expect(
      silentRecorder(db).track('devices-prune', () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    expect(db.statements[1]).toMatch(/consecutive_failures = consecutive_failures \+ 1/);
    expect(db.statements[1]).not.toMatch(/last_succeeded_at/);
  });
});
