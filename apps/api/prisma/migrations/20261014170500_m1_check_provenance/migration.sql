-- Preserve existing checks and identify simulated versus HTTP observations.
CREATE TYPE "CheckSource" AS ENUM ('SIMULATED', 'HTTP');

ALTER TABLE "channel_checks"
ADD COLUMN "source" "CheckSource" NOT NULL DEFAULT 'SIMULATED',
ADD COLUMN "httpStatusCode" INTEGER;
