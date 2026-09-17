-- identity — schema objects Prisma cannot express (ADR 0045, rdm-spec §5).
-- Every statement is idempotent. Applied by `pnpm db:objects` after every migrate.

-- The relay's only query: unpublished rows in id order (rdm-spec §2.10).
CREATE INDEX IF NOT EXISTS outbox_events_unpublished_idx
  ON outbox_events (id)
  WHERE published_at IS NULL;

-- users (rdm-spec I-1). A CHECK cannot be added IF NOT EXISTS, so each is dropped and re-added.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_lower_ck;
ALTER TABLE users ADD CONSTRAINT users_email_lower_ck CHECK (email = lower(email));

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_erased_implies_deleted_ck;
ALTER TABLE users ADD CONSTRAINT users_erased_implies_deleted_ck
  CHECK (erased_at IS NULL OR deleted_at IS NOT NULL);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_locked_until_ck;
ALTER TABLE users ADD CONSTRAINT users_locked_until_ck CHECK (locked_until IS NULL OR is_locked);

-- legal_acceptances (rdm-spec I-12): an account or an install accepted.
ALTER TABLE legal_acceptances DROP CONSTRAINT IF EXISTS legal_acceptances_party_ck;
ALTER TABLE legal_acceptances ADD CONSTRAINT legal_acceptances_party_ck
  CHECK (user_id IS NOT NULL OR device_id IS NOT NULL);

-- sessions (rdm-spec I-3): a wrong client would send tokens down the wrong transport.
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_client_ck;
ALTER TABLE sessions ADD CONSTRAINT sessions_client_ck CHECK (client IN ('CONSOLE', 'WEB', 'MOBILE'));
