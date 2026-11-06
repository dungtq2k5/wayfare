-- CreateTable
CREATE TABLE "tours" (
    "id" UUID NOT NULL,
    "public_code" VARCHAR(12) NOT NULL,
    "area_id" UUID NOT NULL,
    "title_vi" VARCHAR(160) NOT NULL,
    "description_vi" TEXT NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "cover_variants" JSONB,
    "estimated_minutes" SMALLINT NOT NULL,
    "distance_m" INTEGER NOT NULL,
    "is_premium" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(16) NOT NULL,
    "inactive_reason" VARCHAR(24),
    "activation_requested_at" TIMESTAMPTZ(3),
    "sync_version" BIGINT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "tours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tour_localizations" (
    "tour_id" UUID NOT NULL,
    "lang" VARCHAR(16) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" TEXT NOT NULL,
    "source_content_hash" CHAR(64) NOT NULL,
    "translation_source" VARCHAR(16) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tour_localizations_pkey" PRIMARY KEY ("tour_id","lang")
);

-- CreateTable
CREATE TABLE "tour_stops" (
    "tour_id" UUID NOT NULL,
    "position" SMALLINT NOT NULL,
    "place_id" UUID NOT NULL,

    CONSTRAINT "tour_stops_pkey" PRIMARY KEY ("tour_id","position")
);

-- CreateTable
CREATE TABLE "public_codes" (
    "code" VARCHAR(12) NOT NULL,
    "target_type" VARCHAR(8) NOT NULL,
    "target_id" UUID NOT NULL,

    CONSTRAINT "public_codes_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE UNIQUE INDEX "tours_public_code_key" ON "tours"("public_code");

-- CreateIndex
CREATE INDEX "tours_sync_version_idx" ON "tours"("sync_version");

-- CreateIndex
CREATE INDEX "tours_area_status_idx" ON "tours"("area_id", "status");

-- CreateIndex
CREATE INDEX "tour_stops_place_idx" ON "tour_stops"("place_id");

-- CreateIndex
CREATE UNIQUE INDEX "tour_stops_tour_place_key" ON "tour_stops"("tour_id", "place_id");

-- CreateIndex
CREATE UNIQUE INDEX "public_codes_target_key" ON "public_codes"("target_type", "target_id");

-- AddForeignKey
ALTER TABLE "tours" ADD CONSTRAINT "tours_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_localizations" ADD CONSTRAINT "tour_localizations_tour_id_fkey" FOREIGN KEY ("tour_id") REFERENCES "tours"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_stops" ADD CONSTRAINT "tour_stops_tour_id_fkey" FOREIGN KEY ("tour_id") REFERENCES "tours"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_stops" ADD CONSTRAINT "tour_stops_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill: every Place's code joins the one code space (its trigger, in schema-objects.sql,
-- registers every later insert).
INSERT INTO "public_codes" ("code", "target_type", "target_id")
SELECT "public_code", 'PLACE', "id" FROM "places";
