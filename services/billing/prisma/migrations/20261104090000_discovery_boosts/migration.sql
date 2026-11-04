-- An owner's boost slots in use (rdm-spec B-5). The partial unique and the ended check are in
-- schema-objects.sql.
-- CreateTable
CREATE TABLE "discovery_boosts" (
    "id" UUID NOT NULL,
    "billing_account_id" UUID NOT NULL,
    "place_id" UUID NOT NULL,
    "weight" SMALLINT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMPTZ(3),
    "ended_reason" VARCHAR(24),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovery_boosts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "discovery_boosts_billing_account_id_starts_at_idx" ON "discovery_boosts"("billing_account_id", "starts_at");

-- AddForeignKey
ALTER TABLE "discovery_boosts" ADD CONSTRAINT "discovery_boosts_billing_account_id_fkey" FOREIGN KEY ("billing_account_id") REFERENCES "billing_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

