-- A sync version per localization (rdm-spec §1.7): a translation into one language no longer
-- resends its Place to phones in every language. Additive (conventions §8.1): `DEFAULT 0` lets the
-- previous image insert rows during a rolling deploy — `0` is "never stamped", and that image bumps
-- the Place, which still carries the change. The backfill gives each row its parent's version, so
-- every cursor a phone holds stays valid and nothing is downloaded again.

ALTER TABLE "place_localizations" ADD COLUMN "sync_version" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "menu_item_localizations" ADD COLUMN "sync_version" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "tour_localizations" ADD COLUMN "sync_version" BIGINT NOT NULL DEFAULT 0;

UPDATE "place_localizations" l SET "sync_version" = p."sync_version"
FROM "places" p WHERE p."id" = l."place_id";

UPDATE "menu_item_localizations" ml SET "sync_version" = p."sync_version"
FROM "menu_items" mi JOIN "places" p ON p."id" = mi."place_id"
WHERE mi."id" = ml."menu_item_id";

UPDATE "tour_localizations" tl SET "sync_version" = t."sync_version"
FROM "tours" t WHERE t."id" = tl."tour_id";

CREATE INDEX "place_localizations_sync_version_idx" ON "place_localizations"("sync_version");
CREATE INDEX "place_localizations_lang_sync_version_idx" ON "place_localizations"("lang", "sync_version");
CREATE INDEX "menu_item_localizations_sync_version_idx" ON "menu_item_localizations"("sync_version");
CREATE INDEX "tour_localizations_sync_version_idx" ON "tour_localizations"("sync_version");
CREATE INDEX "tour_localizations_lang_sync_version_idx" ON "tour_localizations"("lang", "sync_version");
