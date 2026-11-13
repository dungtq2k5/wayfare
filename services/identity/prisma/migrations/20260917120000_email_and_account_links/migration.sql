-- CreateTable
CREATE TABLE "action_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" VARCHAR(32) NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "target_email" VARCHAR(254) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "invalidated_at" TIMESTAMPTZ(3),
    "ip" VARCHAR(45),
    "user_agent" VARCHAR(512),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_deliveries" (
    "id" UUID NOT NULL,
    "template" VARCHAR(48) NOT NULL,
    "recipient_user_id" UUID,
    "event_id" UUID NOT NULL,
    "to_email_masked" VARCHAR(254),
    "to_email_hash" CHAR(64),
    "provider" VARCHAR(16) NOT NULL,
    "provider_message_id" VARCHAR(255),
    "status" VARCHAR(16) NOT NULL,
    "bounce_type" VARCHAR(16),
    "status_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "action_tokens_token_hash_key" ON "action_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "action_tokens_user_id_purpose_idx" ON "action_tokens"("user_id", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "email_deliveries_provider_message_id_key" ON "email_deliveries"("provider_message_id");

-- CreateIndex
CREATE INDEX "email_deliveries_recipient_user_id_created_at_idx" ON "email_deliveries"("recipient_user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "action_tokens" ADD CONSTRAINT "action_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

