-- catalog — schema objects Prisma cannot express (ADR 0045, rdm-spec §5).
-- Every statement is idempotent. Applied by `pnpm db:objects` after every migrate.
-- The postgis extension is created by the first migration's first line, not here.

-- Delta sync (rdm-spec §1.7). No column default names it: it exists only after this file runs.
CREATE SEQUENCE IF NOT EXISTS catalog_sync_version_seq AS BIGINT;

-- The relay's only query: unpublished rows in id order (rdm-spec §2.10).
CREATE INDEX IF NOT EXISTS outbox_events_unpublished_idx
  ON outbox_events (id)
  WHERE published_at IS NULL;

-- places (rdm-spec C-1, §1.3, §1.4). A CHECK cannot be added IF NOT EXISTS, so each is dropped and re-added.
-- A Venue has an owner; an Editorial Place has none.
ALTER TABLE places DROP CONSTRAINT IF EXISTS places_kind_owner_ck;
ALTER TABLE places ADD CONSTRAINT places_kind_owner_ck
  CHECK (kind IN ('EDITORIAL', 'VENUE') AND (kind = 'VENUE') = (owner_user_id IS NOT NULL));

-- An Editorial Place always auto-narrates.
ALTER TABLE places DROP CONSTRAINT IF EXISTS places_editorial_narrates_ck;
ALTER TABLE places ADD CONSTRAINT places_editorial_narrates_ck
  CHECK (kind = 'VENUE' OR auto_narration_enabled);

-- An Editorial Place is never boosted.
ALTER TABLE places DROP CONSTRAINT IF EXISTS places_editorial_no_boost_ck;
ALTER TABLE places ADD CONSTRAINT places_editorial_no_boost_ck
  CHECK (kind = 'VENUE' OR discovery_boost = 0);

-- Bounds: no radius, however it is set, swallows a block.
ALTER TABLE places DROP CONSTRAINT IF EXISTS places_radius_ck;
ALTER TABLE places ADD CONSTRAINT places_radius_ck CHECK (trigger_radius_m BETWEEN 10 AND 100);

ALTER TABLE places DROP CONSTRAINT IF EXISTS places_priority_ck;
ALTER TABLE places ADD CONSTRAINT places_priority_ck CHECK (narration_priority BETWEEN 0 AND 100);

ALTER TABLE places DROP CONSTRAINT IF EXISTS places_boost_ck;
ALTER TABLE places ADD CONSTRAINT places_boost_ck CHECK (discovery_boost BETWEEN 0 AND 100);

ALTER TABLE places DROP CONSTRAINT IF EXISTS places_price_band_ck;
ALTER TABLE places ADD CONSTRAINT places_price_band_ck
  CHECK (price_band IS NULL OR price_band BETWEEN 1 AND 4);

-- Inactive exactly when a reason says by whom.
ALTER TABLE places DROP CONSTRAINT IF EXISTS places_inactive_reason_ck;
ALTER TABLE places ADD CONSTRAINT places_inactive_reason_ck
  CHECK ((status = 'INACTIVE') = (inactive_reason IS NOT NULL));

-- One menu currency, VND or USD (ADR 0046).
ALTER TABLE places DROP CONSTRAINT IF EXISTS places_menu_currency_ck;
ALTER TABLE places ADD CONSTRAINT places_menu_currency_ck CHECK (menu_currency IN ('VND', 'USD'));

-- The nearby query searches only what it can serve.
CREATE INDEX IF NOT EXISTS places_active_location_gist
  ON places USING GIST (location)
  WHERE status = 'ACTIVE' AND deleted_at IS NULL;

-- The Owner Portal list and the place-limit count.
CREATE INDEX IF NOT EXISTS places_owner_live_idx
  ON places (owner_user_id)
  WHERE deleted_at IS NULL;

-- areas (rdm-spec C-3): containment and overlap checks.
CREATE INDEX IF NOT EXISTS areas_boundary_gist ON areas USING GIST (boundary);
ALTER TABLE areas DROP CONSTRAINT IF EXISTS areas_default_zoom_ck;
ALTER TABLE areas ADD CONSTRAINT areas_default_zoom_ck CHECK (default_zoom BETWEEN 10 AND 18);

-- place_localizations (rdm-spec C-4): READY audio has a file for a known text.
ALTER TABLE place_localizations DROP CONSTRAINT IF EXISTS place_localizations_audio_ready_ck;
ALTER TABLE place_localizations ADD CONSTRAINT place_localizations_audio_ready_ck
  CHECK ((audio_status = 'READY') = (
    audio_object_path IS NOT NULL AND audio_sha256 IS NOT NULL AND audio_source_content_hash IS NOT NULL
  ));

-- menu_items (rdm-spec C-6): the per-currency ceiling is enforced at the edge.
ALTER TABLE menu_items DROP CONSTRAINT IF EXISTS menu_items_price_ck;
ALTER TABLE menu_items ADD CONSTRAINT menu_items_price_ck CHECK (price_minor IS NULL OR price_minor >= 0);

-- place_opening_hours (rdm-spec C-16): a weekday or a date, times unless closed.
ALTER TABLE place_opening_hours DROP CONSTRAINT IF EXISTS place_opening_hours_one_of_ck;
ALTER TABLE place_opening_hours ADD CONSTRAINT place_opening_hours_one_of_ck
  CHECK ((weekday IS NULL) <> (specific_date IS NULL));

ALTER TABLE place_opening_hours DROP CONSTRAINT IF EXISTS place_opening_hours_times_ck;
ALTER TABLE place_opening_hours ADD CONSTRAINT place_opening_hours_times_ck
  CHECK (is_closed OR (opens_at IS NOT NULL AND closes_at IS NOT NULL));

ALTER TABLE place_opening_hours DROP CONSTRAINT IF EXISTS place_opening_hours_weekday_ck;
ALTER TABLE place_opening_hours ADD CONSTRAINT place_opening_hours_weekday_ck
  CHECK (weekday IS NULL OR weekday BETWEEN 1 AND 7);

-- place_submissions (rdm-spec C-11). One pending UPDATE per Place: a new one supersedes it.
CREATE UNIQUE INDEX IF NOT EXISTS place_submissions_one_pending_update
  ON place_submissions (place_id)
  WHERE status = 'PENDING' AND kind = 'UPDATE';

-- A CREATE names its Place only once approved; an UPDATE always does.
ALTER TABLE place_submissions DROP CONSTRAINT IF EXISTS place_submissions_update_has_place_ck;
ALTER TABLE place_submissions ADD CONSTRAINT place_submissions_update_has_place_ck
  CHECK (kind IN ('CREATE', 'UPDATE') AND (kind = 'CREATE' OR place_id IS NOT NULL));

-- A decision is stamped exactly when one was made.
ALTER TABLE place_submissions DROP CONSTRAINT IF EXISTS place_submissions_reviewed_ck;
ALTER TABLE place_submissions ADD CONSTRAINT place_submissions_reviewed_ck
  CHECK ((status IN ('APPROVED', 'REJECTED')) = (reviewed_at IS NOT NULL));

-- An UPDATE carries its base (hash and snapshot); a CREATE carries none.
ALTER TABLE place_submissions DROP CONSTRAINT IF EXISTS place_submissions_update_base_ck;
ALTER TABLE place_submissions ADD CONSTRAINT place_submissions_update_base_ck
  CHECK ((kind = 'CREATE') = (base_snapshot IS NULL AND base_editable_hash IS NULL));

-- map_packs (rdm-spec C-14): one published pack per area; its zoom range is a range.
CREATE UNIQUE INDEX IF NOT EXISTS map_packs_one_published
  ON map_packs (area_id)
  WHERE status = 'PUBLISHED';
ALTER TABLE map_packs DROP CONSTRAINT IF EXISTS map_packs_zoom_ck;
ALTER TABLE map_packs ADD CONSTRAINT map_packs_zoom_ck CHECK (max_zoom >= min_zoom);
