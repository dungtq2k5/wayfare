-- billing — schema objects Prisma cannot express (ADR 0045, rdm-spec §5).
-- Every statement is idempotent. Applied by `pnpm db:objects` after every migrate.

-- The relay's only query: unpublished rows in id order (rdm-spec §2.10).
CREATE INDEX IF NOT EXISTS outbox_events_unpublished_idx
  ON outbox_events (id)
  WHERE published_at IS NULL;

-- plans (rdm-spec B-1): a live code is unique; a retired plan's code is reusable.
CREATE UNIQUE INDEX IF NOT EXISTS plans_code_live_key
  ON plans (code)
  WHERE deleted_at IS NULL;

-- A plan that sells vouchers states its commission, and only then; within bounds. A CHECK cannot be
-- added IF NOT EXISTS, so each is dropped and re-added.
ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_commission_ck;
ALTER TABLE plans ADD CONSTRAINT plans_commission_ck
  CHECK (
    can_sell_vouchers = (voucher_commission_bps IS NOT NULL)
    AND (voucher_commission_bps IS NULL OR voucher_commission_bps BETWEEN 0 AND 3000)
  );

-- plan_prices (rdm-spec B-2): one active price per plan and interval.
CREATE UNIQUE INDEX IF NOT EXISTS plan_prices_one_active_interval
  ON plan_prices (plan_id, billing_interval)
  WHERE is_active;

-- Money is USD, in positive minor units (rdm-spec §1.9).
ALTER TABLE plan_prices DROP CONSTRAINT IF EXISTS plan_prices_currency_ck;
ALTER TABLE plan_prices ADD CONSTRAINT plan_prices_currency_ck CHECK (currency = 'USD');

ALTER TABLE plan_prices DROP CONSTRAINT IF EXISTS plan_prices_amount_ck;
ALTER TABLE plan_prices ADD CONSTRAINT plan_prices_amount_ck CHECK (amount_minor > 0);
