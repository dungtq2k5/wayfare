-- rdm-spec N-6: the UI string bundles both apps read. One row per namespace, locale and English
-- source version; `failed_keys` has no column default, so every write states it.
CREATE TABLE "ui_bundles" (
    "id" UUID NOT NULL,
    "namespace" VARCHAR(32) NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "source_hash" CHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "origin" VARCHAR(16) NOT NULL,
    "messages" JSONB,
    "failed_keys" VARCHAR(128)[] NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ui_bundles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ui_bundles_namespace_locale_hash_key"
    ON "ui_bundles" ("namespace", "locale", "source_hash");
