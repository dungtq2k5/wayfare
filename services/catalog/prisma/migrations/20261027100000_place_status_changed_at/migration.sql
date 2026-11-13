-- AlterTable: when a Place's status last changed, for the stuck-Places check (rdm-spec C-1).
-- Backfilled from updated_at, the closest the past records; the trigger in
-- prisma/sql/schema-objects.sql stamps it from now on.
ALTER TABLE "places" ADD COLUMN "status_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "places" SET "status_changed_at" = "updated_at";
