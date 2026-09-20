-- Map packs and favourites (rdm-spec C-13, C-14). The one-published index and the zoom CHECK live in schema-objects.sql.
-- CreateTable
CREATE TABLE "favorites" (
    "device_id" UUID NOT NULL,
    "place_id" UUID NOT NULL,
    "user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("device_id","place_id")
);

-- CreateTable
CREATE TABLE "map_packs" (
    "id" UUID NOT NULL,
    "area_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "pmtiles_object_path" VARCHAR(512) NOT NULL,
    "pmtiles_sha256" CHAR(64) NOT NULL,
    "pmtiles_bytes" BIGINT NOT NULL,
    "style_object_path" VARCHAR(512) NOT NULL,
    "assets" JSONB NOT NULL,
    "source" VARCHAR(64) NOT NULL,
    "source_date" DATE NOT NULL,
    "min_zoom" SMALLINT NOT NULL,
    "max_zoom" SMALLINT NOT NULL,
    "build_tool" VARCHAR(64) NOT NULL,
    "objects_deleted_at" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),
    "retired_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "map_packs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "favorites_user_idx" ON "favorites"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "map_packs_area_version_key" ON "map_packs"("area_id", "version");

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "map_packs" ADD CONSTRAINT "map_packs_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

