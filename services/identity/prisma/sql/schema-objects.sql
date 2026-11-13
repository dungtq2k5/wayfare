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

-- action_tokens (rdm-spec I-9): the addresses a live revert reserves.
CREATE INDEX IF NOT EXISTS action_tokens_live_revert_idx
  ON action_tokens (target_email)
  WHERE purpose = 'EMAIL_CHANGE_REVERT' AND used_at IS NULL AND invalidated_at IS NULL;

-- email_deliveries (rdm-spec I-13): one email per event per recipient, a null recipient included.
CREATE UNIQUE INDEX IF NOT EXISTS email_deliveries_one_per_event
  ON email_deliveries (template, event_id, recipient_user_id) NULLS NOT DISTINCT;

-- notifications (rdm-spec I-10): the unread count on every console page load.
CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON notifications (recipient_user_id, created_at DESC)
  WHERE read_at IS NULL;

-- owner_registrations (rdm-spec I-8): one open application per person.
CREATE UNIQUE INDEX IF NOT EXISTS owner_registrations_one_pending
  ON owner_registrations (user_id)
  WHERE status = 'PENDING';

-- A decision has its review time, and only a decision has one.
ALTER TABLE owner_registrations DROP CONSTRAINT IF EXISTS owner_registrations_reviewed_ck;
ALTER TABLE owner_registrations ADD CONSTRAINT owner_registrations_reviewed_ck
  CHECK ((status IN ('APPROVED', 'REJECTED')) = (reviewed_at IS NOT NULL));

-- account_recoveries (rdm-spec I-14): one live case per owner.
CREATE UNIQUE INDEX IF NOT EXISTS account_recoveries_one_live
  ON account_recoveries (user_id)
  WHERE status IN ('PENDING_APPROVAL', 'ON_HOLD', 'LINK_SENT');

-- At least two checks passed, and one of them was the phone callback.
ALTER TABLE account_recoveries DROP CONSTRAINT IF EXISTS account_recoveries_evidence_ck;
ALTER TABLE account_recoveries ADD CONSTRAINT account_recoveries_evidence_ck
  CHECK (cardinality(evidence_codes) >= 2 AND 'PHONE_CALLBACK' = ANY(evidence_codes));

-- Nobody approves a case they opened.
ALTER TABLE account_recoveries DROP CONSTRAINT IF EXISTS account_recoveries_four_eyes_ck;
ALTER TABLE account_recoveries ADD CONSTRAINT account_recoveries_four_eyes_ck
  CHECK (approved_by_id IS NULL OR approved_by_id <> opened_by_id);
