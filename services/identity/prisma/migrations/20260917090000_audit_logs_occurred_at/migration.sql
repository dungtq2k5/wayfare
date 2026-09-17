-- CreateIndex
CREATE INDEX "audit_logs_occurred_at_id_idx" ON "audit_logs"("occurred_at" DESC, "id" DESC);

