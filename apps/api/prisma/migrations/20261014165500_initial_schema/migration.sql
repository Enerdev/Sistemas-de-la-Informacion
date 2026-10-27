-- Initial SIMONA-BN PostgreSQL schema.
-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('APP', 'INTERNET_BANKING', 'MULTIRED_VIRTUAL');

-- CreateEnum
CREATE TYPE "ChannelStatus" AS ENUM ('UNKNOWN', 'AVAILABLE', 'DEGRADED', 'UNAVAILABLE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "CheckResult" AS ENUM ('SUCCESS', 'DEGRADED', 'FAILURE', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "IncidentActorType" AS ENUM ('USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ChannelStatusChangeSource" AS ENUM ('USER', 'CHECK', 'SYSTEM');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channels" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "type" "ChannelType" NOT NULL,
    "simulatedTarget" VARCHAR(200) NOT NULL,
    "currentStatus" "ChannelStatus" NOT NULL DEFAULT 'UNKNOWN',
    "monitoringEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitoring_configs" (
    "id" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "checkIntervalSeconds" INTEGER NOT NULL DEFAULT 60,
    "timeoutMillis" INTEGER NOT NULL DEFAULT 5000,
    "latencyWarningMillis" INTEGER NOT NULL DEFAULT 1500,
    "failureThreshold" INTEGER NOT NULL DEFAULT 3,
    "recoveryThreshold" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "monitoring_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_checks" (
    "id" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "result" "CheckResult" NOT NULL,
    "observedStatus" "ChannelStatus" NOT NULL,
    "responseTimeMs" INTEGER,
    "detail" VARCHAR(500),
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "channel_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "severity" "IncidentSeverity" NOT NULL DEFAULT 'MEDIUM',
    "summary" VARCHAR(240) NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_events" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "actorId" UUID,
    "actorType" "IncidentActorType" NOT NULL,
    "previousStatus" "IncidentStatus",
    "newStatus" "IncidentStatus" NOT NULL,
    "note" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "incident_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_status_history" (
    "id" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "actorId" UUID,
    "previousStatus" "ChannelStatus",
    "newStatus" "ChannelStatus" NOT NULL,
    "source" "ChannelStatusChangeSource" NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "channel_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");
CREATE INDEX "sessions_userId_expiresAt_idx" ON "sessions"("userId", "expiresAt");
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");
CREATE UNIQUE INDEX "channels_code_key" ON "channels"("code");
CREATE INDEX "channels_monitoringEnabled_currentStatus_idx" ON "channels"("monitoringEnabled", "currentStatus");
CREATE UNIQUE INDEX "monitoring_configs_channelId_key" ON "monitoring_configs"("channelId");
CREATE INDEX "channel_checks_channelId_checkedAt_idx" ON "channel_checks"("channelId", "checkedAt");
CREATE INDEX "channel_checks_checkedAt_idx" ON "channel_checks"("checkedAt");
CREATE INDEX "incidents_channelId_status_idx" ON "incidents"("channelId", "status");
CREATE INDEX "incidents_status_openedAt_idx" ON "incidents"("status", "openedAt");
CREATE INDEX "incident_events_incidentId_createdAt_idx" ON "incident_events"("incidentId", "createdAt");
CREATE INDEX "incident_events_actorId_idx" ON "incident_events"("actorId");
CREATE INDEX "channel_status_history_channelId_changedAt_idx" ON "channel_status_history"("channelId", "changedAt");
CREATE INDEX "channel_status_history_actorId_idx" ON "channel_status_history"("actorId");

-- A channel may have only one incident in an active lifecycle state.
CREATE UNIQUE INDEX "incidents_one_active_per_channel_key"
ON "incidents"("channelId")
WHERE "status" IN ('OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS');

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "monitoring_configs" ADD CONSTRAINT "monitoring_configs_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "channel_checks" ADD CONSTRAINT "channel_checks_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "channel_status_history" ADD CONSTRAINT "channel_status_history_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "channel_status_history" ADD CONSTRAINT "channel_status_history_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
