-- AlterTable
ALTER TABLE "incidents" ADD COLUMN     "startedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "payment_schedule_imports" (
    "id" UUID NOT NULL,
    "fileName" VARCHAR(200) NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "createdCount" INTEGER NOT NULL,
    "updatedCount" INTEGER NOT NULL,
    "importedById" UUID,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_schedule_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_dates" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "group" VARCHAR(60) NOT NULL,
    "description" VARCHAR(200),
    "importId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_dates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_schedule_imports_importedAt_idx" ON "payment_schedule_imports"("importedAt");

-- CreateIndex
CREATE INDEX "payment_dates_date_idx" ON "payment_dates"("date");

-- CreateIndex
CREATE UNIQUE INDEX "payment_dates_date_group_key" ON "payment_dates"("date", "group");

-- AddForeignKey
ALTER TABLE "payment_schedule_imports" ADD CONSTRAINT "payment_schedule_imports_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_dates" ADD CONSTRAINT "payment_dates_importId_fkey" FOREIGN KEY ("importId") REFERENCES "payment_schedule_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Consistencia de fechas de incidencias (M2): inicio <= detección; resuelta/cerrada exigen sus fechas
ALTER TABLE "incidents"
  ADD CONSTRAINT "incidents_started_before_detected_check" CHECK ("startedAt" IS NULL OR "startedAt" <= "detectedAt"),
  ADD CONSTRAINT "incidents_resolved_at_check" CHECK ("status" NOT IN ('RESOLVED', 'CLOSED') OR "resolvedAt" IS NOT NULL),
  ADD CONSTRAINT "incidents_closed_at_check" CHECK ("status" <> 'CLOSED' OR "closedAt" IS NOT NULL);

ALTER TABLE "payment_schedule_imports"
  ADD CONSTRAINT "payment_schedule_imports_counts_check"
  CHECK ("rowCount" >= 0 AND "createdCount" >= 0 AND "updatedCount" >= 0 AND "createdCount" + "updatedCount" = "rowCount");
