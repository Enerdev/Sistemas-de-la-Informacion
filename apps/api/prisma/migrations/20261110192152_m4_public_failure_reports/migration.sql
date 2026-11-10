-- CreateEnum
CREATE TYPE "FailureReportStatus" AS ENUM ('NEW', 'REVIEWED', 'LINKED', 'DISMISSED');

-- CreateTable
CREATE TABLE "failure_reports" (
    "id" UUID NOT NULL,
    "referenceCode" VARCHAR(16) NOT NULL,
    "channelId" UUID NOT NULL,
    "incidentId" UUID,
    "reviewedById" UUID,
    "status" "FailureReportStatus" NOT NULL DEFAULT 'NEW',
    "description" VARCHAR(1000) NOT NULL,
    "contactEmail" VARCHAR(254),
    "occurredAt" TIMESTAMP(3),
    "reviewNote" VARCHAR(500),
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "failure_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "failure_reports_referenceCode_key" ON "failure_reports"("referenceCode");

-- CreateIndex
CREATE INDEX "failure_reports_status_createdAt_idx" ON "failure_reports"("status", "createdAt");

-- CreateIndex
CREATE INDEX "failure_reports_channelId_createdAt_idx" ON "failure_reports"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "failure_reports_incidentId_idx" ON "failure_reports"("incidentId");

-- AddForeignKey
ALTER TABLE "failure_reports" ADD CONSTRAINT "failure_reports_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "failure_reports" ADD CONSTRAINT "failure_reports_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "failure_reports" ADD CONSTRAINT "failure_reports_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Consistencia de la revisión
ALTER TABLE "failure_reports"
  ADD CONSTRAINT "failure_reports_linked_incident_check" CHECK ("status" <> 'LINKED' OR "incidentId" IS NOT NULL),
  ADD CONSTRAINT "failure_reports_reviewed_at_check" CHECK ("status" = 'NEW' OR "reviewedAt" IS NOT NULL);
