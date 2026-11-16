-- analytics — schema objects Prisma cannot express (ADR 0045, rdm-spec §5).
-- Every statement is idempotent. Applied by `pnpm db:objects` after every migrate.

-- consents (rdm-spec A-1): a decision is one of the two states.
ALTER TABLE consents DROP CONSTRAINT IF EXISTS consents_state_ck;
ALTER TABLE consents ADD CONSTRAINT consents_state_ck CHECK (state IN ('GRANTED', 'WITHDRAWN'));

-- events (rdm-spec A-2): a listening time is never negative.
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_listen_ms_ck;
ALTER TABLE events ADD CONSTRAINT events_listen_ms_ck CHECK (listen_ms IS NULL OR listen_ms >= 0);

-- location_cell_hourly (rdm-spec A-3): a cell under HEATMAP_MIN_DEVICES (5) is a person, never a row.
ALTER TABLE location_cell_hourly DROP CONSTRAINT IF EXISTS location_cell_hourly_min_devices_ck;
ALTER TABLE location_cell_hourly ADD CONSTRAINT location_cell_hourly_min_devices_ck
  CHECK (device_estimate >= 5);
