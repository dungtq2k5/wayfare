-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "data" JSONB NOT NULL,
    "event_id" UUID NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "notifications_expires_idx" ON "notifications"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_recipient_event_key" ON "notifications"("recipient_user_id", "event_id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

