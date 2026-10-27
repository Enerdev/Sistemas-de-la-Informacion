import { describe, expect, it, vi } from "vitest";
import { createMonitoringScheduler } from "./scheduler.js";
import type { Schedule, ScheduledJob } from "./scheduler.js";

describe("monitoring scheduler", () => {
  it("registers only one cron task when started repeatedly", () => {
    const stop = vi.fn();
    const schedule = vi.fn<Schedule>(() => ({ stop }));
    const scheduler = createMonitoringScheduler(schedule, async () => {});

    expect(scheduler.start()).toBe(true);
    expect(scheduler.start()).toBe(false);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith("*/15 * * * * *", expect.any(Function));

    scheduler.stop();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("does not overlap sweeps when a scheduled callback fires twice", async () => {
    let callback: (() => void) | undefined;
    let completeSweep: (() => void) | undefined;
    const sweep = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          completeSweep = resolve;
        }),
    );
    const schedule: Schedule = (_expression, registeredCallback): ScheduledJob => {
      callback = registeredCallback;
      return { stop() {} };
    };
    const scheduler = createMonitoringScheduler(schedule, sweep);

    scheduler.start();
    callback?.();
    callback?.();
    expect(sweep).toHaveBeenCalledTimes(1);

    completeSweep?.();
    await vi.waitFor(() => expect(sweep).toHaveBeenCalledTimes(1));
    scheduler.stop();
  });
});
