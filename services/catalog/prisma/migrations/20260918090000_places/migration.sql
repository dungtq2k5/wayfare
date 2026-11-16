-- PostGIS first: the shadow database `db:drift` replays into starts without it (rdm-spec §5).
CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateTable
CREATE TABLE "places" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "owner_user_id" UUID,
    "public_code" VARCHAR(12) NOT NULL,
    "category_id" UUID NOT NULL,
    "area_id" UUID NOT NULL,
    "name_vi" VARCHAR(160) NOT NULL,
    "description_vi" TEXT NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "location" geography(Point, 4326) NOT NULL,
    "address_vi" VARCHAR(255),
    "trigger_radius_m" SMALLINT NOT NULL DEFAULT 30,
    "narration_priority" SMALLINT NOT NULL DEFAULT 50,
    "auto_narration_enabled" BOOLEAN NOT NULL,
    "discovery_boost" SMALLINT NOT NULL DEFAULT 0,
    "price_band" SMALLINT,
    "menu_currency" CHAR(3) NOT NULL DEFAULT 'VND',
    "phone" VARCHAR(20),
    "website_url" VARCHAR(512),
    "status" VARCHAR(16) NOT NULL,
    "inactive_reason" VARCHAR(24),
    "activation_requested_at" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),
    "sync_version" BIGINT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "applies_to" VARCHAR(16) NOT NULL,
    "icon" VARCHAR(64) NOT NULL,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "areas" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name_vi" VARCHAR(120) NOT NULL,
    "boundary" geography(Polygon, 4326) NOT NULL,
    "center" geography(Point, 4326) NOT NULL,
    "default_zoom" SMALLINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "place_localizations" (
    "place_id" UUID NOT NULL,
    "lang" VARCHAR(16) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT NOT NULL,
    "source_content_hash" CHAR(64) NOT NULL,
    "translation_source" VARCHAR(16) NOT NULL,
    "audio_status" VARCHAR(16) NOT NULL,
    "audio_source_content_hash" CHAR(64),
    "audio_asset_id" UUID,
    "audio_object_path" VARCHAR(512),
    "audio_sha256" CHAR(64),
    "audio_bytes" INTEGER,
    "audio_duration_ms" INTEGER,
    "voice_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "place_localizations_pkey" PRIMARY KEY ("place_id","lang")
);

-- CreateTable
CREATE TABLE "place_photos" (
    "id" UUID NOT NULL,
    "place_id" UUID NOT NULL,
    "sort_order" SMALLINT NOT NULL,
    "variants" JSONB NOT NULL,
    "original_sha256" CHAR(64) NOT NULL,
    "alt_text_vi" VARCHAR(255),
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "place_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_items" (
    "id" UUID NOT NULL,
    "place_id" UUID NOT NULL,
    "name_vi" VARCHAR(120) NOT NULL,
    "description_vi" VARCHAR(500),
    "content_hash" CHAR(64) NOT NULL,
    "price_minor" INTEGER,
    "sort_order" SMALLINT NOT NULL,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_item_localizations" (
    "menu_item_id" UUID NOT NULL,
    "lang" VARCHAR(16) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "source_content_hash" CHAR(64) NOT NULL,
    "translation_source" VARCHAR(16) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "menu_item_localizations_pkey" PRIMARY KEY ("menu_item_id","lang")
);

-- CreateTable
CREATE TABLE "pending_uploads" (
    "id" UUID NOT NULL,
    "purpose" VARCHAR(24) NOT NULL,
    "uploader_user_id" UUID NOT NULL,
    "object_path" VARCHAR(512) NOT NULL,
    "declared_content_type" VARCHAR(64) NOT NULL,
    "max_bytes" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3),
    "sniffed_content_type" VARCHAR(64),
    "bytes" INTEGER,
    "sha256" CHAR(64),
    "variants" JSONB,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "place_qr_scans_daily" (
    "place_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "scans" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "place_qr_scans_daily_pkey" PRIMARY KEY ("place_id","day")
);

-- CreateTable
CREATE TABLE "place_opening_hours" (
    "id" UUID NOT NULL,
    "place_id" UUID NOT NULL,
    "weekday" SMALLINT,
    "specific_date" DATE,
    "opens_at" TIME(0),
    "closes_at" TIME(0),
    "is_closed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "place_opening_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orphaned_objects" (
    "object_path" VARCHAR(512) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orphaned_objects_pkey" PRIMARY KEY ("object_path")
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
CREATE UNIQUE INDEX "places_public_code_key" ON "places"("public_code");

-- CreateIndex
CREATE INDEX "places_sync_version_idx" ON "places"("sync_version");

-- CreateIndex
CREATE INDEX "places_area_status_idx" ON "places"("area_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "categories_code_key" ON "categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "areas_code_key" ON "areas"("code");

-- CreateIndex
CREATE UNIQUE INDEX "place_photos_place_original_key" ON "place_photos"("place_id", "original_sha256");

-- CreateIndex
CREATE INDEX "menu_items_place_idx" ON "menu_items"("place_id");

-- CreateIndex
CREATE UNIQUE INDEX "pending_uploads_object_path_key" ON "pending_uploads"("object_path");

-- CreateIndex
CREATE INDEX "pending_uploads_uploader_idx" ON "pending_uploads"("uploader_user_id");

-- CreateIndex
CREATE INDEX "place_opening_hours_place_idx" ON "place_opening_hours"("place_id");

-- AddForeignKey
ALTER TABLE "places" ADD CONSTRAINT "places_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "places" ADD CONSTRAINT "places_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "place_localizations" ADD CONSTRAINT "place_localizations_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "place_photos" ADD CONSTRAINT "place_photos_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_localizations" ADD CONSTRAINT "menu_item_localizations_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "place_qr_scans_daily" ADD CONSTRAINT "place_qr_scans_daily_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "place_opening_hours" ADD CONSTRAINT "place_opening_hours_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE CASCADE;

