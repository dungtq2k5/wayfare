-- Owner submissions (rdm-spec C-11). The partial unique index and the CHECKs live in schema-objects.sql.
-- CreateTable
CREATE TABLE "place_submissions" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "place_id" UUID,
    "owner_user_id" UUID NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_schema_version" SMALLINT NOT NULL,
    "base_editable_hash" CHAR(64),
    "base_snapshot" JSONB,
    "category_code_override" VARCHAR(32),
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewed_by_id" UUID,
    "decision_note" TEXT,
    "internal_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "place_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "place_submissions_place_idx" ON "place_submissions"("place_id");

-- CreateIndex
CREATE INDEX "place_submissions_owner_status_idx" ON "place_submissions"("owner_user_id", "status");

-- CreateIndex
CREATE INDEX "place_submissions_queue_idx" ON "place_submissions"("status", "submitted_at");

-- AddForeignKey
ALTER TABLE "place_submissions" ADD CONSTRAINT "place_submissions_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

