-- rdm-spec N-2: a task waiting on a speech provider that could not be reached. Such an attempt
-- spends none of the task's attempts and is retried on a longer back-off for a bounded window.
ALTER TABLE "synthesis_tasks"
    ADD COLUMN "failure_reason" VARCHAR(32),
    ADD COLUMN "provider_waits" SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN "provider_down_since" TIMESTAMPTZ(3),
    ADD COLUMN "next_attempt_at" TIMESTAMPTZ(3);
