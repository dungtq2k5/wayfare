-- CreateTable
CREATE TABLE "owner_entitlements" (
    "owner_user_id" UUID NOT NULL,
    "entitlements_version" BIGINT NOT NULL,
    "auto_narration" BOOLEAN NOT NULL,
    "narration_language_scope" VARCHAR(16) NOT NULL,
    "max_places" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "owner_entitlements_pkey" PRIMARY KEY ("owner_user_id")
);

