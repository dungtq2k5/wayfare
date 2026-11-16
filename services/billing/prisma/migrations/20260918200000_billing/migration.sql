-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "stripe_product_id" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" SMALLINT NOT NULL,
    "max_places" INTEGER NOT NULL,
    "auto_narration" BOOLEAN NOT NULL,
    "narration_language_scope" VARCHAR(16) NOT NULL,
    "max_photos_per_place" SMALLINT NOT NULL,
    "max_menu_items_per_place" SMALLINT NOT NULL,
    "discovery_boost_slots" SMALLINT NOT NULL,
    "ai_credits_per_day" SMALLINT NOT NULL,
    "analytics_level" VARCHAR(16) NOT NULL,
    "can_sell_vouchers" BOOLEAN NOT NULL,
    "voucher_commission_bps" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_prices" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "stripe_price_id" VARCHAR(255) NOT NULL,
    "billing_interval" VARCHAR(8) NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_accounts" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "stripe_customer_id" VARCHAR(255),
    "plan_id" UUID NOT NULL,
    "plan_price_id" UUID,
    "stripe_subscription_id" VARCHAR(255),
    "subscription_status" VARCHAR(24) NOT NULL DEFAULT 'NONE',
    "current_period_start" TIMESTAMPTZ(3),
    "current_period_end" TIMESTAMPTZ(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "last_stripe_event_at" TIMESTAMPTZ(3),
    "last_invoice_event_at" TIMESTAMPTZ(3),
    "dunning_started_at" TIMESTAMPTZ(3),
    "entitlements_pinned" BOOLEAN NOT NULL DEFAULT false,
    "max_places" INTEGER NOT NULL,
    "auto_narration" BOOLEAN NOT NULL,
    "narration_language_scope" VARCHAR(16) NOT NULL,
    "max_photos_per_place" SMALLINT NOT NULL,
    "max_menu_items_per_place" SMALLINT NOT NULL,
    "discovery_boost_slots" SMALLINT NOT NULL,
    "ai_credits_per_day" SMALLINT NOT NULL,
    "analytics_level" VARCHAR(16) NOT NULL,
    "can_sell_vouchers" BOOLEAN NOT NULL,
    "voucher_commission_bps" INTEGER,
    "entitlements_version" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_events" (
    "id" UUID NOT NULL,
    "stripe_event_id" VARCHAR(255) NOT NULL,
    "endpoint" VARCHAR(16) NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "stripe_created_at" TIMESTAMPTZ(3) NOT NULL,
    "stripe_account_id" VARCHAR(255),
    "billing_account_id" UUID,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "error_log" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "subject" VARCHAR(128) NOT NULL,
    "payload" JSONB NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "trace_parent" VARCHAR(55),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_events" (
    "consumer" VARCHAR(64) NOT NULL,
    "event_id" UUID NOT NULL,
    "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("consumer","event_id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "job_name" VARCHAR(64) NOT NULL,
    "last_started_at" TIMESTAMPTZ(3),
    "last_succeeded_at" TIMESTAMPTZ(3),
    "last_failed_at" TIMESTAMPTZ(3),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "last_duration_ms" INTEGER,
    "last_error" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("job_name")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_stripe_product_id_key" ON "plans"("stripe_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_prices_stripe_price_id_key" ON "plan_prices"("stripe_price_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_accounts_owner_user_id_key" ON "billing_accounts"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_accounts_stripe_customer_id_key" ON "billing_accounts"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_accounts_stripe_subscription_id_key" ON "billing_accounts"("stripe_subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_events_stripe_event_id_key" ON "billing_events"("stripe_event_id");

-- CreateIndex
CREATE INDEX "billing_events_event_type_idx" ON "billing_events"("event_type");

-- CreateIndex
CREATE INDEX "billing_events_billing_account_id_stripe_created_at_idx" ON "billing_events"("billing_account_id", "stripe_created_at" DESC);

-- AddForeignKey
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_plan_price_id_fkey" FOREIGN KEY ("plan_price_id") REFERENCES "plan_prices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_billing_account_id_fkey" FOREIGN KEY ("billing_account_id") REFERENCES "billing_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

