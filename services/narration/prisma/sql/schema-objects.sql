-- narration — schema objects Prisma cannot express (ADR 0045, rdm-spec §5).
-- Every statement is idempotent. Applied by `pnpm db:objects` after every migrate.

-- The relay's only query: unpublished rows in id order (rdm-spec §2.10).
CREATE INDEX IF NOT EXISTS outbox_events_unpublished_idx
  ON outbox_events (id)
  WHERE published_at IS NULL;

-- synthesis_jobs (rdm-spec N-1). A CHECK cannot be added IF NOT EXISTS, so each is dropped and re-added.
-- Only a UI bundle has no target row.
ALTER TABLE synthesis_jobs DROP CONSTRAINT IF EXISTS synthesis_jobs_target_ck;
ALTER TABLE synthesis_jobs ADD CONSTRAINT synthesis_jobs_target_ck
  CHECK ((target_type = 'UI_BUNDLE') = (target_id IS NULL));

-- A job always asks for at least one language.
ALTER TABLE synthesis_jobs DROP CONSTRAINT IF EXISTS synthesis_jobs_langs_nonempty_ck;
ALTER TABLE synthesis_jobs ADD CONSTRAINT synthesis_jobs_langs_nonempty_ck
  CHECK (cardinality(requested_langs) > 0);

-- The monitor's live list, and recovery's sweep.
CREATE INDEX IF NOT EXISTS synthesis_jobs_live_status_idx
  ON synthesis_jobs (status)
  WHERE status IN ('QUEUED', 'RUNNING', 'PAUSED');

-- synthesis_tasks (rdm-spec N-2): one active task per target, language and source version —
-- the backstop behind the task-key lock; a second one coalesces.
CREATE UNIQUE INDEX IF NOT EXISTS synthesis_tasks_one_active
  ON synthesis_tasks (target_type, target_id, lang, source_content_hash)
  WHERE status IN ('QUEUED', 'RUNNING');

-- pronunciation_entries (rdm-spec N-5): one entry per term and language, and one for every
-- language — two indexes, because NULLs are never equal.
CREATE UNIQUE INDEX IF NOT EXISTS pronunciation_term_lang_key
  ON pronunciation_entries (term, target_lang)
  WHERE target_lang IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pronunciation_term_all_key
  ON pronunciation_entries (term)
  WHERE target_lang IS NULL;

-- A phoneme names its alphabet; an alias has none.
ALTER TABLE pronunciation_entries DROP CONSTRAINT IF EXISTS pronunciation_alphabet_ck;
ALTER TABLE pronunciation_entries ADD CONSTRAINT pronunciation_alphabet_ck
  CHECK ((replacement_type = 'PHONEME') = (alphabet IS NOT NULL));

-- localization_overrides (rdm-spec N-7): one active correction per source version, and never
-- of the source language itself.
CREATE UNIQUE INDEX IF NOT EXISTS localization_overrides_one_active
  ON localization_overrides (target_type, target_id, lang, source_content_hash)
  WHERE status = 'ACTIVE';

ALTER TABLE localization_overrides DROP CONSTRAINT IF EXISTS localization_overrides_not_vi_ck;
ALTER TABLE localization_overrides ADD CONSTRAINT localization_overrides_not_vi_ck CHECK (lang <> 'vi');
