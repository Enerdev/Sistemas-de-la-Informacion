-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('CHANNEL_DOWN', 'CHANNEL_RECOVERED');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "incidents" ALTER COLUMN "reason" DROP DEFAULT,
ALTER COLUMN "evidence" DROP DEFAULT;

-- CreateTable
CREATE TABLE "notification_recipients" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "name" VARCHAR(120),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notifyDown" BOOLEAN NOT NULL DEFAULT true,
    "notifyRecovery" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "channelId" UUID NOT NULL,
    "incidentId" UUID,
    "recipientId" UUID,
    "recipientEmail" VARCHAR(254) NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "body" VARCHAR(4000) NOT NULL,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" VARCHAR(500),
    "providerMessageId" VARCHAR(255),
    "previewUrl" VARCHAR(500),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_recipients_email_key" ON "notification_recipients"("email");

-- CreateIndex
CREATE INDEX "notifications_status_nextAttemptAt_idx" ON "notifications"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "notifications_incidentId_idx" ON "notifications"("incidentId");

-- CreateIndex
CREATE INDEX "notifications_channelId_createdAt_idx" ON "notifications"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_recipientId_idx" ON "notifications"("recipientId");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "notification_recipients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Consistencia del registro de envíos
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_attempts_check" CHECK ("attempts" >= 0 AND "maxAttempts" >= 1),
  ADD CONSTRAINT "notifications_sent_at_check" CHECK ("status" <> 'SENT' OR "sentAt" IS NOT NULL);
