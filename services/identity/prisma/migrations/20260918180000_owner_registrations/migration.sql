-- CreateTable
CREATE TABLE "owner_registrations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "business_name" VARCHAR(160) NOT NULL,
    "business_address" VARCHAR(255) NOT NULL,
    "business_registration_no" VARCHAR(32),
    "contact_name" VARCHAR(120) NOT NULL,
    "contact_phone" VARCHAR(20) NOT NULL,
    "national_id_ciphertext" TEXT,
    "national_id_last4" CHAR(4),
    "applicant_note" TEXT,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewed_by_id" UUID,
    "decision_note" TEXT,
    "internal_note" TEXT,
    "pii_redacted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "owner_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "owner_registrations_user_id_idx" ON "owner_registrations"("user_id");

-- CreateIndex
CREATE INDEX "owner_registrations_status_submitted_at_idx" ON "owner_registrations"("status", "submitted_at");

-- AddForeignKey
ALTER TABLE "owner_registrations" ADD CONSTRAINT "owner_registrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_registrations" ADD CONSTRAINT "owner_registrations_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

