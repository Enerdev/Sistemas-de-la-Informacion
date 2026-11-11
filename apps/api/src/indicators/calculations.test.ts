import { ChannelStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  availabilityPercent,
  isWithinWindows,
  limaDateKey,
  mean,
  paymentDayWindows,
  statusDurations,
} from "./calculations.js";

const hour = 60 * 60 * 1000;
const at = (iso: string) => new Date(iso);
const period = { start: at("2025-03-01T05:00:00.000Z"), end: at("2025-03-03T05:00:00.000Z") };

describe("statusDurations", () => {
  it("splits the window by the status in force at each moment", () => {
    const durations = statusDurations(ChannelStatus.AVAILABLE, [
      { changedAt: at("2025-03-02T10:00:00.000Z"), newStatus: ChannelStatus.UNAVAILABLE },
      { changedAt: at("2025-03-02T12:00:00.000Z"), newStatus: ChannelStatus.DEGRADED },
      { changedAt: at("2025-03-02T13:00:00.000Z"), newStatus: ChannelStatus.MAINTENANCE },
      { changedAt: at("2025-03-02T14:00:00.000Z"), newStatus: ChannelStatus.AVAILABLE },
    ], period);

    expect(durations).toEqual({ operationalMs: 45 * hour, downMs: 2 * hour, maintenanceMs: hour, unknownMs: 0 });
    expect(availabilityPercent(durations)).toBeCloseTo((45 / 47) * 100, 6);
  });

  it("applies transitions before the window as the starting status and ignores those after it", () => {
    const durations = statusDurations(ChannelStatus.UNKNOWN, [
      { changedAt: at("2025-02-28T00:00:00.000Z"), newStatus: ChannelStatus.UNAVAILABLE },
      { changedAt: at("2025-03-04T00:00:00.000Z"), newStatus: ChannelStatus.AVAILABLE },
    ], period);

    expect(durations.downMs).toBe(48 * hour);
    expect(availabilityPercent(durations)).toBe(0);
  });

  it("reports no availability when the channel was never verified", () => {
    const durations = statusDurations(ChannelStatus.UNKNOWN, [], period);
    expect(durations.unknownMs).toBe(48 * hour);
    expect(availabilityPercent(durations)).toBeNull();
  });
});

describe("payment day windows", () => {
  it("maps calendar dates to Lima days, removes duplicates and clips to the period", () => {
    const windows = paymentDayWindows([
      at("2025-03-02T00:00:00.000Z"),
      at("2025-03-02T00:00:00.000Z"),
      at("2025-03-03T00:00:00.000Z"),
      at("2025-03-10T00:00:00.000Z"),
    ], period);

    expect(windows).toEqual([{ start: at("2025-03-02T05:00:00.000Z"), end: at("2025-03-03T05:00:00.000Z") }]);
    expect(isWithinWindows(at("2025-03-02T04:59:59.000Z"), windows)).toBe(false);
    expect(isWithinWindows(at("2025-03-02T05:00:00.000Z"), windows)).toBe(true);
    expect(isWithinWindows(at("2025-03-03T05:00:00.000Z"), windows)).toBe(false);
  });

  it("formats Lima calendar days", () => {
    expect(limaDateKey(at("2025-03-02T04:00:00.000Z"))).toBe("2025-03-01");
    expect(limaDateKey(at("2025-03-02T05:00:00.000Z"))).toBe("2025-03-02");
  });
});

describe("mean", () => {
  it("returns null without values", () => {
    expect(mean([])).toBeNull();
    expect(mean([1, 2, 6])).toBe(3);
  });
});
