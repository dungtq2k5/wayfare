-- A Checkout session expires after 30 minutes; until then the owner can still start a
-- subscription, so erasure waits (rdm-spec B-3).
ALTER TABLE "billing_accounts" ADD COLUMN "checkout_open_until" TIMESTAMPTZ(3);
