import type { ChannelStatus, CheckResult, CheckSource } from "@prisma/client";

export type CheckObservation = {
  source: CheckSource;
  result: CheckResult;
  responseTimeMs: number | null;
  httpStatusCode: number | null;
  detail: string | null;
};

export type PreviousCheck = {
  result: CheckResult;
};

export type MonitoringSettings = {
  latencyWarningMillis: number;
  failureThreshold: number;
  recoveryThreshold: number;
};

export type CheckResultRecord = {
  id: string;
  channelId: string;
  source: CheckSource;
  result: CheckResult;
  observedStatus: ChannelStatus;
  responseTimeMs: number | null;
  httpStatusCode: number | null;
  detail: string | null;
  checkedAt: Date;
};
