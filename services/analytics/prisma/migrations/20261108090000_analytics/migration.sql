-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "consents" (
    "id" UUID NOT NULL,
    "analytics_device_id" UUID NOT NULL,
    "state" VARCHAR(16) NOT NULL,
    "policy_version" VARCHAR(16) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "analytics_device_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "event_type" VARCHAR(48) NOT NULL,
    "trigger" VARCHAR(16),
    "place_id" UUID,
    "lang" VARCHAR(16),
    "audio_tier" VARCHAR(8),
    "listen_ms" INTEGER,
    "props" JSONB NOT NULL DEFAULT '{}',
    "platform" VARCHAR(16) NOT NULL,
    "app_version" VARCHAR(32) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_cell_hourly" (
    "cell" VARCHAR(12) NOT NULL,
    "bucket_start" TIMESTAMPTZ(3) NOT NULL,
    "device_estimate" INTEGER NOT NULL,
    "computed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_cell_hourly_pkey" PRIMARY KEY ("cell","bucket_start")
);

-- CreateTable
CREATE TABLE "place_daily_stats" (
    "place_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "narrations_started" INTEGER NOT NULL DEFAULT 0,
    "narrations_completed" INTEGER NOT NULL DEFAULT 0,
    "narrations_abandoned" INTEGER NOT NULL DEFAULT 0,
    "geofence_started" INTEGER NOT NULL DEFAULT 0,
    "tap_started" INTEGER NOT NULL DEFAULT 0,
    "qr_started" INTEGER NOT NULL DEFAULT 0,
    "listen_ms_sum" BIGINT NOT NULL DEFAULT 0,
    "listen_count" INTEGER NOT NULL DEFAULT 0,
    "opens" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "place_daily_stats_pkey" PRIMARY KEY ("place_id","day")
);

-- CreateTable
CREATE TABLE "runtime_activity_hourly" (
    "area_id" UUID NOT NULL,
    "bucket_start" TIMESTAMPTZ(3) NOT NULL,
    "active_estimate" INTEGER NOT NULL,
    "computed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "runtime_activity_hourly_pkey" PRIMARY KEY ("area_id","bucket_start")
);

-- CreateTable
CREATE TABLE "activity_daily_stats" (
    "day" DATE NOT NULL,
    "lang" VARCHAR(16) NOT NULL,
    "platform" VARCHAR(16) NOT NULL,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "active_devices_estimate" INTEGER NOT NULL DEFAULT 0,
    "narrations_started" INTEGER NOT NULL DEFAULT 0,
    "narrations_completed" INTEGER NOT NULL DEFAULT 0,
    "tier1_narrations" INTEGER NOT NULL DEFAULT 0,
    "tier1_5_narrations" INTEGER NOT NULL DEFAULT 0,
    "tier2_narrations" INTEGER NOT NULL DEFAULT 0,
    "tier3_narrations" INTEGER NOT NULL DEFAULT 0,
    "pack_installs" INTEGER NOT NULL DEFAULT 0,
    "searches" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_daily_stats_pkey" PRIMARY KEY ("day","lang","platform")
);

-- CreateTable
CREATE TABLE "rollup_days" (
    "day" DATE NOT NULL,
    "computed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rollup_days_pkey" PRIMARY KEY ("day")
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
CREATE INDEX "consents_analytics_device_id_recorded_at_idx" ON "consents"("analytics_device_id", "recorded_at" DESC);

-- CreateIndex
CREATE INDEX "events_occurred_at_idx" ON "events"("occurred_at");

-- CreateIndex
CREATE INDEX "events_place_id_occurred_at_idx" ON "events"("place_id", "occurred_at");

-- CreateIndex
CREATE INDEX "events_analytics_device_id_idx" ON "events"("analytics_device_id");

-- CreateIndex
CREATE INDEX "location_cell_hourly_bucket_start_idx" ON "location_cell_hourly"("bucket_start");

-- CreateIndex
CREATE INDEX "place_daily_stats_day_idx" ON "place_daily_stats"("day");

