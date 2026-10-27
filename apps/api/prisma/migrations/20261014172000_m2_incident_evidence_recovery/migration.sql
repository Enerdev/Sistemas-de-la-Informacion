CREATE TYPE "IncidentEventKind" AS ENUM ('OPENED', 'STATUS_CHANGED', 'CHANNEL_RECOVERED');

ALTER TABLE "incidents"
ADD COLUMN "detectionCheckId" UUID,
ADD COLUMN "reason" VARCHAR(500) NOT NULL DEFAULT 'Motivo no registrado en la migración.',
ADD COLUMN "evidence" VARCHAR(2000) NOT NULL DEFAULT 'Evidencia no disponible para incidentes históricos.',
ADD COLUMN "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "recoveredAt" TIMESTAMP(3);

ALTER TABLE "incident_events"
ADD COLUMN "checkId" UUID,
ADD COLUMN "kind" "IncidentEventKind" NOT NULL DEFAULT 'STATUS_CHANGED';

CREATE INDEX "incidents_channelId_detectedAt_idx" ON "incidents"("channelId", "detectedAt");
CREATE INDEX "incidents_detectionCheckId_idx" ON "incidents"("detectionCheckId");
CREATE INDEX "incident_events_checkId_idx" ON "incident_events"("checkId");

ALTER TABLE "incidents"
ADD CONSTRAINT "incidents_detectionCheckId_fkey"
FOREIGN KEY ("detectionCheckId") REFERENCES "channel_checks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "incident_events"
ADD CONSTRAINT "incident_events_checkId_fkey"
FOREIGN KEY ("checkId") REFERENCES "channel_checks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
