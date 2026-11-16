-- rdm-spec N-2: a task carrying a change — a human edit or revert, a dictionary change — that
-- follows an active task which had already started runs again once that task ends, rather than
-- ending with a result made before its change.
ALTER TABLE "synthesis_tasks"
    ADD COLUMN "rerun_after_leader" BOOLEAN NOT NULL DEFAULT false;
