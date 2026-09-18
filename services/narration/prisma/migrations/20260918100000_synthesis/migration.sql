-- CreateTable
CREATE TABLE "synthesis_jobs" (
    "id" UUID NOT NULL,
    "target_type" VARCHAR(16) NOT NULL,
    "target_id" UUID,
    "trigger" VARCHAR(24) NOT NULL,
    "source_content_hash" CHAR(64) NOT NULL,
    "requested_langs" VARCHAR(16)[],
    "include_audio" BOOLEAN NOT NULL,
    "priority" SMALLINT NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "total_tasks" SMALLINT NOT NULL,
    "completed_tasks" SMALLINT NOT NULL DEFAULT 0,
    "failed_tasks" SMALLINT NOT NULL DEFAULT 0,
    "requested_by_user_id" UUID,
    "requested_by_device_id" UUID,
    "heartbeat_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "error_summary" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "synthesis_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "synthesis_tasks" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "target_type" VARCHAR(16) NOT NULL,
    "target_id" UUID,
    "lang" VARCHAR(16) NOT NULL,
    "source_content_hash" CHAR(64) NOT NULL,
    "stage" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "translation_provider" VARCHAR(32),
    "speech_provider" VARCHAR(32),
    "voice_id" VARCHAR(64),
    "cache_key" CHAR(64),
    "audio_asset_id" UUID,
    "coalesced_into_task_id" UUID,
    "last_error" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "synthesis_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audio_assets" (
    "id" UUID NOT NULL,
    "cache_key" CHAR(64) NOT NULL,
    "lang" VARCHAR(16) NOT NULL,
    "voice_id" VARCHAR(64) NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "format" VARCHAR(32) NOT NULL,
    "object_path" VARCHAR(512) NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "bytes" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "ssml_chars" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_referenced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audio_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "translation_cache" (
    "cache_key" CHAR(64) NOT NULL,
    "source_lang" VARCHAR(16) NOT NULL,
    "target_lang" VARCHAR(16) NOT NULL,
    "translated_text" TEXT NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "source_chars" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "translation_cache_pkey" PRIMARY KEY ("cache_key")
);

-- CreateTable
CREATE TABLE "pronunciation_entries" (
    "id" UUID NOT NULL,
    "term" VARCHAR(120) NOT NULL,
    "target_lang" VARCHAR(16),
    "replacement_type" VARCHAR(16) NOT NULL,
    "replacement" VARCHAR(255) NOT NULL,
    "alphabet" VARCHAR(16),
    "note" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pronunciation_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "localization_overrides" (
    "id" UUID NOT NULL,
    "target_type" VARCHAR(16) NOT NULL,
    "target_id" UUID NOT NULL,
    "lang" VARCHAR(16) NOT NULL,
    "source_content_hash" CHAR(64) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "status" VARCHAR(16) NOT NULL,
    "edited_by_id" UUID NOT NULL,
    "reverted_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "localization_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "subject" VARCHAR(128) NOT NULL,
    "payload" JSONB NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "trace_parent" VARCHAR(55),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_events" (
    "consumer" VARCHAR(64) NOT NULL,
    "event_id" UUID NOT NULL,
    "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("consumer","event_id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "job_name" VARCHAR(64) NOT NULL,
    "last_started_at" TIMESTAMPTZ(3),
    "last_succeeded_at" TIMESTAMPTZ(3),
    "last_failed_at" TIMESTAMPTZ(3),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "last_duration_ms" INTEGER,
    "last_error" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("job_name")
);

-- CreateIndex
CREATE INDEX "synthesis_jobs_target_idx" ON "synthesis_jobs"("target_type", "target_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "synthesis_tasks_coalesced_into_idx" ON "synthesis_tasks"("coalesced_into_task_id");

-- CreateIndex
CREATE UNIQUE INDEX "synthesis_tasks_job_lang_key" ON "synthesis_tasks"("job_id", "lang");

-- CreateIndex
CREATE UNIQUE INDEX "audio_assets_cache_key_key" ON "audio_assets"("cache_key");

-- CreateIndex
CREATE UNIQUE INDEX "audio_assets_object_path_key" ON "audio_assets"("object_path");

-- CreateIndex
CREATE INDEX "audio_assets_last_referenced_idx" ON "audio_assets"("last_referenced_at");

-- CreateIndex
CREATE INDEX "translation_cache_last_used_idx" ON "translation_cache"("last_used_at");

-- AddForeignKey
ALTER TABLE "synthesis_tasks" ADD CONSTRAINT "synthesis_tasks_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "synthesis_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "synthesis_tasks" ADD CONSTRAINT "synthesis_tasks_audio_asset_id_fkey" FOREIGN KEY ("audio_asset_id") REFERENCES "audio_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "synthesis_tasks" ADD CONSTRAINT "synthesis_tasks_coalesced_into_task_id_fkey" FOREIGN KEY ("coalesced_into_task_id") REFERENCES "synthesis_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

