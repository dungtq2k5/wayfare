-- rdm-spec I-15: a sign-in provider linked to an account, by the provider's subject (ADR 0062).
-- One link per provider and account, and one account per provider subject; erasure deletes the
-- rows, and the account's deletion cascades.
CREATE TABLE "user_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" VARCHAR(16) NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "email_at_link" VARCHAR(254) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_identities_provider_subject_key"
    ON "user_identities" ("provider", "subject");

CREATE UNIQUE INDEX "user_identities_user_id_provider_key"
    ON "user_identities" ("user_id", "provider");

ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
