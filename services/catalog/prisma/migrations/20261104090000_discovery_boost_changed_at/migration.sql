-- The version guard of places.discovery_boost (rdm-spec C-1): the newest billing.boosts.changed
-- applied, by its changedAt.
-- AlterTable
ALTER TABLE "places" ADD COLUMN     "discovery_boost_changed_at" TIMESTAMPTZ(3);

