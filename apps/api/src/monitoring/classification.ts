import { ChannelStatus, CheckResult } from "@prisma/client";
import type { CheckObservation, MonitoringSettings, PreviousCheck } from "./types.js";

function isFailure(result: CheckResult): boolean {
  return result === CheckResult.FAILURE || result === CheckResult.TIMEOUT;
}

function isHealthy(result: CheckResult): boolean {
  return result === CheckResult.SUCCESS || result === CheckResult.DEGRADED;
}

function countConsecutive(
  previousChecksNewestFirst: PreviousCheck[],
  predicate: (result: CheckResult) => boolean,
): number {
  let count = 0;
  for (const check of previousChecksNewestFirst) {
    if (!predicate(check.result)) break;
    count += 1;
  }
  return count;
}

export function classifyChannelStatus(
  currentStatus: ChannelStatus,
  observation: CheckObservation,
  previousChecksNewestFirst: PreviousCheck[],
  settings: MonitoringSettings,
): ChannelStatus {
  if (currentStatus === ChannelStatus.MAINTENANCE) {
    return ChannelStatus.MAINTENANCE;
  }

  if (isFailure(observation.result)) {
    const consecutiveFailures =
      countConsecutive(previousChecksNewestFirst, isFailure) + 1;
    if (consecutiveFailures >= settings.failureThreshold) {
      return ChannelStatus.UNAVAILABLE;
    }
    return currentStatus === ChannelStatus.UNAVAILABLE
      ? ChannelStatus.UNAVAILABLE
      : ChannelStatus.DEGRADED;
  }

  const isSlow =
    observation.responseTimeMs !== null
    && observation.responseTimeMs >= settings.latencyWarningMillis;

  if (currentStatus === ChannelStatus.UNAVAILABLE) {
    const consecutiveRecoveries =
      countConsecutive(previousChecksNewestFirst, isHealthy) + 1;
    if (consecutiveRecoveries < settings.recoveryThreshold) {
      return ChannelStatus.UNAVAILABLE;
    }
  }

  return isSlow ? ChannelStatus.DEGRADED : ChannelStatus.AVAILABLE;
}
