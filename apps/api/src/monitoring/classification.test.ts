import { ChannelStatus, CheckResult, CheckSource } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { classifyChannelStatus } from "./classification.js";
import type { CheckObservation } from "./types.js";

const settings = {
  latencyWarningMillis: 1500,
  failureThreshold: 3,
  recoveryThreshold: 2,
};

function observation(
  result: CheckResult,
  responseTimeMs: number | null = 25,
): CheckObservation {
  return {
    source: CheckSource.SIMULATED,
    result,
    responseTimeMs,
    httpStatusCode: null,
    detail: null,
  };
}

describe("classifyChannelStatus", () => {
  it("classifies response times immediately below and at the configured boundary", () => {
    expect(
      classifyChannelStatus(
        ChannelStatus.UNKNOWN,
        observation(CheckResult.SUCCESS, settings.latencyWarningMillis - 1),
        [],
        settings,
      ),
    ).toBe(ChannelStatus.AVAILABLE);

    expect(
      classifyChannelStatus(
        ChannelStatus.UNKNOWN,
        observation(CheckResult.SUCCESS, settings.latencyWarningMillis),
        [],
        settings,
      ),
    ).toBe(ChannelStatus.DEGRADED);
  });

  it("marks a channel unavailable only at the consecutive failure threshold", () => {
    expect(
      classifyChannelStatus(
        ChannelStatus.AVAILABLE,
        observation(CheckResult.FAILURE, null),
        [{ result: CheckResult.FAILURE }],
        settings,
      ),
    ).toBe(ChannelStatus.DEGRADED);

    expect(
      classifyChannelStatus(
        ChannelStatus.DEGRADED,
        observation(CheckResult.TIMEOUT, null),
        [{ result: CheckResult.FAILURE }, { result: CheckResult.TIMEOUT }],
        settings,
      ),
    ).toBe(ChannelStatus.UNAVAILABLE);
  });

  it("requires the recovery threshold and preserves maintenance", () => {
    expect(
      classifyChannelStatus(
        ChannelStatus.UNAVAILABLE,
        observation(CheckResult.SUCCESS, 25),
        [],
        settings,
      ),
    ).toBe(ChannelStatus.UNAVAILABLE);

    expect(
      classifyChannelStatus(
        ChannelStatus.UNAVAILABLE,
        observation(CheckResult.SUCCESS, 25),
        [{ result: CheckResult.SUCCESS }],
        settings,
      ),
    ).toBe(ChannelStatus.AVAILABLE);

    expect(
      classifyChannelStatus(
        ChannelStatus.MAINTENANCE,
        observation(CheckResult.FAILURE, null),
        [],
        settings,
      ),
    ).toBe(ChannelStatus.MAINTENANCE);
  });
});
