import { ChannelStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { availabilityPercent, isWithinWindows, paymentDayWindows, statusDurations } from "../indicators/calculations.js";
import { demoScenarios, generateDemoData } from "./generate.js";

const end = new Date("2026-11-11T18:03:00.000Z");
const actors = { operatorId: "00000000-0000-4000-8000-0000000000aa", adminId: "00000000-0000-4000-8000-0000000000bb" };
const data = generateDemoData(end, actors);
const minute = 60 * 1000;

describe("demo data generator", () => {
  it("covers six weeks with 5-minute checks and ends with every channel operational", () => {
    expect(data.channels.map(({ code }) => code)).toEqual(["APP_BN", "BANCA_INTERNET", "MULTIRED_VIRTUAL"]);
    expect(data.channels.every(({ currentStatus }) => currentStatus === ChannelStatus.AVAILABLE)).toBe(true);
    expect(data.period.end).toEqual(new Date("2026-11-11T18:00:00.000Z"));
    expect(data.checks.every(({ checkedAt }) => checkedAt.getTime() % (5 * minute) === 0)).toBe(true);
    expect(data.checks.length).toBeGreaterThan(30_000);
  });

  it("keeps the status history continuous and opens one incident per simulated outage", () => {
    for (const channel of data.channels) {
      const history = data.history.filter(({ channelId }) => channelId === channel.id);
      history.slice(1).forEach((entry, index) => expect(entry.previousStatus).toBe(history[index]!.newStatus));
      expect(history.at(-1)!.newStatus).toBe(channel.currentStatus);
    }
    expect(data.incidents).toHaveLength(demoScenarios.filter(({ kind }) => kind === "outage").length);
    for (const incident of data.incidents) {
      // Umbral de 3 fallos cada 5 minutos: la detección ocurre 10 minutos después del primer fallo.
      expect(incident.detectedAt.getTime() - incident.startedAt.getTime()).toBe(10 * minute);
      expect(incident.recoveredAt!.getTime()).toBeGreaterThan(incident.detectedAt.getTime());
      if (incident.status === "CLOSED") {
        expect(incident.resolvedAt).not.toBeNull();
        expect(incident.closedAt!.getTime()).toBeGreaterThan(incident.resolvedAt!.getTime());
      }
    }
  });

  it("provides the variety the demonstration needs", () => {
    expect(new Set(data.incidents.map(({ status }) => status))).toEqual(new Set(["CLOSED", "IN_PROGRESS", "OPEN"]));
    expect(new Set(data.incidents.map(({ severity }) => severity))).toEqual(new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]));
    expect(data.history.some(({ newStatus }) => newStatus === ChannelStatus.MAINTENANCE)).toBe(true);
    expect(data.checks.some(({ observedStatus }) => observedStatus === ChannelStatus.DEGRADED)).toBe(true);
    expect(data.notifications.filter(({ status }) => status === "FAILED")).toHaveLength(2);
    expect(data.notifications.filter(({ status }) => status === "SENT").every(({ sentAt }) => sentAt !== null)).toBe(true);
    expect(new Set(data.failureReports.map(({ status }) => status))).toEqual(new Set(["NEW", "LINKED", "DISMISSED"]));
    expect(data.failureReports.every(({ referenceCode }) => /^R-[A-Z2-9]{8}$/.test(referenceCode))).toBe(true);
    expect(data.failureReports.filter(({ status }) => status === "LINKED").every(({ incidentId }) => incidentId)).toBe(true);
  });

  it("places outages on payment days so the exception report has content", () => {
    const windows = paymentDayWindows(data.paymentDates.map(({ date }) => date), { start: data.period.start, end: data.period.end });
    expect(windows).toHaveLength(5);
    expect(data.incidents.filter(({ startedAt }) => isWithinWindows(startedAt, windows)).length).toBeGreaterThanOrEqual(3);

    const app = data.channels.find(({ code }) => code === "APP_BN")!;
    const history = data.history.filter(({ channelId }) => channelId === app.id);
    const availability = availabilityPercent(statusDurations(ChannelStatus.UNKNOWN, history, data.period))!;
    expect(availability).toBeGreaterThan(98);
    expect(availability).toBeLessThan(100);
  });

  it("is deterministic for the same end instant", () => {
    const again = generateDemoData(end, actors);
    expect(again.checks.map(({ responseTimeMs }) => responseTimeMs)).toEqual(data.checks.map(({ responseTimeMs }) => responseTimeMs));
    expect(again.incidents.map(({ detectedAt }) => detectedAt.getTime())).toEqual(data.incidents.map(({ detectedAt }) => detectedAt.getTime()));
  });
});
