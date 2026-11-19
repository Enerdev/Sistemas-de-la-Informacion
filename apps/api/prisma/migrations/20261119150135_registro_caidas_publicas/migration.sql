-- CreateEnum
CREATE TYPE "OutageRecordKind" AS ENUM ('FAILURE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "PaymentOverlap" AS ENUM ('YES', 'NO', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SourceConfidence" AS ENUM ('OFFICIAL', 'PRESS_WITH_STATEMENT', 'PRESS', 'UNVERIFIED');

-- CreateTable
CREATE TABLE "public_outage_records" (
    "id" UUID NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "kind" "OutageRecordKind" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "startTime" VARCHAR(5),
    "endTime" VARCHAR(5),
    "channels" VARCHAR(300) NOT NULL,
    "symptoms" VARCHAR(500) NOT NULL,
    "paymentOverlap" "PaymentOverlap" NOT NULL,
    "officialStatement" BOOLEAN,
    "confidence" "SourceConfidence" NOT NULL,
    "note" VARCHAR(500),
    "sourceUrl" VARCHAR(500) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_outage_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "public_outage_records_code_key" ON "public_outage_records"("code");

-- CreateIndex
CREATE INDEX "public_outage_records_startDate_idx" ON "public_outage_records"("startDate");

-- Consistencia del registro: el fin no antecede al inicio y las horas usan HH:mm
ALTER TABLE "public_outage_records"
  ADD CONSTRAINT "public_outage_records_dates_check" CHECK ("endDate" >= "startDate"),
  ADD CONSTRAINT "public_outage_records_start_time_check" CHECK ("startTime" IS NULL OR "startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT "public_outage_records_end_time_check" CHECK ("endTime" IS NULL OR "endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT "public_outage_records_source_url_check" CHECK ("sourceUrl" ~ '^https://');
