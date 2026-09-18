// Each rdm-spec §5 narration object refuses the row it exists to refuse, or exists for its query
// (ADR 0045).
import { newId } from '@wayfare/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testPrisma, truncateAll } from '../setup/database';

const prisma = testPrisma();
const hash = 'a'.repeat(64);
let jobId: string;
const otherJobId = newId();
const targetId = newId();

beforeAll(async () => {
  await truncateAll(prisma);
  jobId = newId();
  await prisma.$executeRawUnsafe(`
    INSERT INTO synthesis_jobs (id, target_type, target_id, trigger, source_content_hash, requested_langs,
      include_audio, priority, status, total_tasks)
    VALUES ('${jobId}', 'PLACE', '${targetId}', 'MANUAL', '${hash}', '{vi,en}', true, 4, 'QUEUED', 2),
           ('${otherJobId}', 'PLACE', '${targetId}', 'ON_DEMAND', '${hash}', '{en}', true, 1, 'QUEUED', 1)`);
  await prisma.$executeRawUnsafe(`
    INSERT INTO synthesis_tasks (id, job_id, target_type, target_id, lang, source_content_hash, stage, status)
    VALUES ('${newId()}', '${jobId}', 'PLACE', '${targetId}', 'en', '${hash}', 'TRANSLATE', 'QUEUED')`);
  await prisma.$executeRawUnsafe(`
    INSERT INTO pronunciation_entries (id, term, target_lang, replacement_type, replacement, created_by_id, updated_by_id)
    VALUES ('${newId()}', 'Bến Thành', 'en', 'SUB', 'Ben Tan', '${newId()}', '${newId()}'),
           ('${newId()}', 'Bến Thành', NULL, 'SUB', 'Ben Tan', '${newId()}', '${newId()}')`);
  await prisma.$executeRawUnsafe(`
    INSERT INTO localization_overrides (id, target_type, target_id, lang, source_content_hash, name, status, edited_by_id)
    VALUES ('${newId()}', 'PLACE', '${targetId}', 'en', '${hash}', 'Ben Thanh Market', 'ACTIVE', '${newId()}')`);
});
afterAll(() => prisma.$disconnect());

/** Runs a statement that must fail on `constraint`, in a transaction that is rolled back. */
async function refuses(constraint: string, sql: string): Promise<void> {
  const failure = await prisma
    .$transaction(async (tx) => {
      await tx.$executeRawUnsafe(sql);
      throw new Error('ROLLBACK: the statement was accepted');
    })
    .catch((error: unknown) => error);
  expect(String(failure instanceof Error ? failure.message : failure)).toContain(constraint);
}

const job = (set: string) => `UPDATE synthesis_jobs SET ${set} WHERE id = '${jobId}'`;

describe('narration schema objects', () => {
  it.each([
    ['synthesis_jobs_target_ck', () => job('target_id = NULL')],
    ['synthesis_jobs_target_ck', () => job(`target_type = 'UI_BUNDLE'`)],
    ['synthesis_jobs_langs_nonempty_ck', () => job(`requested_langs = '{}'`)],
    [
      'synthesis_tasks_one_active',
      () => `INSERT INTO synthesis_tasks (id, job_id, target_type, target_id, lang, source_content_hash, stage, status)
             VALUES ('${newId()}', '${otherJobId}', 'PLACE', '${targetId}', 'en', '${hash}', 'TRANSLATE', 'RUNNING')`,
    ],
    [
      'pronunciation_term_lang_key',
      () => `INSERT INTO pronunciation_entries (id, term, target_lang, replacement_type, replacement, created_by_id, updated_by_id)
             VALUES ('${newId()}', 'Bến Thành', 'en', 'SUB', 'x', '${newId()}', '${newId()}')`,
    ],
    [
      'pronunciation_term_all_key',
      () => `INSERT INTO pronunciation_entries (id, term, target_lang, replacement_type, replacement, created_by_id, updated_by_id)
             VALUES ('${newId()}', 'Bến Thành', NULL, 'SUB', 'x', '${newId()}', '${newId()}')`,
    ],
    [
      'pronunciation_alphabet_ck',
      () => `INSERT INTO pronunciation_entries (id, term, target_lang, replacement_type, replacement, created_by_id, updated_by_id)
             VALUES ('${newId()}', 'Phở', 'en', 'PHONEME', 'fɜː', '${newId()}', '${newId()}')`,
    ],
    [
      'pronunciation_alphabet_ck',
      () => `INSERT INTO pronunciation_entries (id, term, target_lang, replacement_type, replacement, alphabet, created_by_id, updated_by_id)
             VALUES ('${newId()}', 'Phở', 'en', 'SUB', 'Fuh', 'ipa', '${newId()}', '${newId()}')`,
    ],
    [
      'localization_overrides_one_active',
      () => `INSERT INTO localization_overrides (id, target_type, target_id, lang, source_content_hash, name, status, edited_by_id)
             VALUES ('${newId()}', 'PLACE', '${targetId}', 'en', '${hash}', 'Other', 'ACTIVE', '${newId()}')`,
    ],
    [
      'localization_overrides_not_vi_ck',
      () => `INSERT INTO localization_overrides (id, target_type, target_id, lang, source_content_hash, name, status, edited_by_id)
             VALUES ('${newId()}', 'PLACE', '${targetId}', 'vi', '${hash}', 'Chợ', 'ACTIVE', '${newId()}')`,
    ],
  ] as [string, () => string][])('%s', async (constraint, sql) => {
    await refuses(constraint, sql());
  });

  it.each([
    ['synthesis_jobs_live_status_idx', 'synthesis_jobs', 'status'],
    ['outbox_events_unpublished_idx', 'outbox_events', 'published_at IS NULL'],
  ])('%s is a partial index on %s', async (name, table, predicate) => {
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = ${name} AND tablename = ${table}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toMatch(/ WHERE /);
    expect(rows[0]!.indexdef).toContain(predicate);
  });
});
