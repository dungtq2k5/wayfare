-- rdm-spec I-14: a support-assisted recovery of an owner account whose login email is lost.
-- `evidence_codes` has no column default, so every write states what was checked; the cancel
-- token's hash is unique and cleared when the case ends.
CREATE TABLE "account_recoveries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "requested_email" VARCHAR(254) NOT NULL,
    "evidence_codes" VARCHAR(32)[],
    "support_reference" VARCHAR(64) NOT NULL,
    "opened_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "decision_note" TEXT,
    "hold_until" TIMESTAMPTZ(3),
    "cancel_token_hash" CHAR(64),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_recoveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "account_recoveries_cancel_token_key"
    ON "account_recoveries" ("cancel_token_hash");

CREATE INDEX "account_recoveries_user_id_idx" ON "account_recoveries" ("user_id");

CREATE INDEX "account_recoveries_status_created_at_idx"
    ON "account_recoveries" ("status", "created_at");

ALTER TABLE "account_recoveries" ADD CONSTRAINT "account_recoveries_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "account_recoveries" ADD CONSTRAINT "account_recoveries_opened_by_id_fkey"
    FOREIGN KEY ("opened_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "account_recoveries" ADD CONSTRAINT "account_recoveries_approved_by_id_fkey"
    FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
