-- DropForeignKey
ALTER TABLE "failure_reports" DROP CONSTRAINT "failure_reports_incidentId_fkey";

-- AddForeignKey
ALTER TABLE "failure_reports" ADD CONSTRAINT "failure_reports_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
