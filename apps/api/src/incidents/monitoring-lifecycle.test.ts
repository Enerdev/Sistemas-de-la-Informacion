import {
  ChannelStatus,
  CheckResult,
  IncidentStatus,
  Prisma,
} from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { recordMonitoringIncident } from "./lifecycle.js";

function transactionMock() {
  return {
    incident: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    incidentEvent: {
      create: vi.fn(),
    },
  } as unknown as Prisma.TransactionClient;
}

const baseInput = {
  channelId: "00000000-0000-4000-8000-000000000001",
  previousStatus: ChannelStatus.DEGRADED,
  newStatus: ChannelStatus.DEGRADED,
  checkId: "00000000-0000-4000-8000-000000000002",
  checkedAt: new Date("2026-10-14T10:00:00.000Z"),
  result: CheckResult.FAILURE,
  detail: "Fallo simulado.",
  failureThreshold: 3,
  previousResultsNewestFirst: [] as CheckResult[],
};

describe("incident actions driven by monitoring", () => {
  it("does not open an incident for one failure below a multi-failure threshold", async () => {
    const transaction = transactionMock();
    await recordMonitoringIncident(transaction, {
      ...baseInput,
      previousResultsNewestFirst: [CheckResult.FAILURE],
    });

    expect(transaction.incident.create).not.toHaveBeenCalled();
    expect(transaction.incident.findFirst).not.toHaveBeenCalled();
  });

  it("opens once at the threshold with detection reason, evidence and audit event", async () => {
    const transaction = transactionMock();
    transaction.incident.findFirst = vi.fn().mockResolvedValue(null);
    transaction.incident.create = vi.fn().mockResolvedValue({ id: "incident-1" });

    await recordMonitoringIncident(transaction, {
      ...baseInput,
      previousStatus: ChannelStatus.DEGRADED,
      newStatus: ChannelStatus.UNAVAILABLE,
      previousResultsNewestFirst: [CheckResult.FAILURE, CheckResult.TIMEOUT],
    });

    expect(transaction.incident.create).toHaveBeenCalledOnce();
    expect(transaction.incident.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: IncidentStatus.OPEN,
        reason: expect.stringContaining("3 fallos consecutivos"),
        evidence: expect.stringContaining('"failureThreshold":3'),
        detectionCheckId: baseInput.checkId,
        events: {
          create: expect.objectContaining({
            kind: "OPENED",
            actorType: "SYSTEM",
            newStatus: "OPEN",
          }),
        },
      }),
    }));
  });

  it("deduplicates further failures while an equivalent active incident exists", async () => {
    const transaction = transactionMock();
    transaction.incident.findFirst = vi.fn().mockResolvedValueOnce({ id: "existing-active" });

    await recordMonitoringIncident(transaction, {
      ...baseInput,
      newStatus: ChannelStatus.UNAVAILABLE,
      previousResultsNewestFirst: [CheckResult.FAILURE, CheckResult.FAILURE],
    });

    expect(transaction.incident.create).not.toHaveBeenCalled();
    expect(transaction.incident.findFirst).toHaveBeenCalledOnce();
  });

  it("records technical recovery without resolving the administrative incident", async () => {
    const transaction = transactionMock();
    transaction.incident.findFirst = vi.fn().mockResolvedValue({
      id: "incident-1",
      status: IncidentStatus.IN_PROGRESS,
    });
    transaction.incident.update = vi.fn().mockResolvedValue({});
    transaction.incidentEvent.create = vi.fn().mockResolvedValue({});

    await recordMonitoringIncident(transaction, {
      ...baseInput,
      previousStatus: ChannelStatus.UNAVAILABLE,
      newStatus: ChannelStatus.AVAILABLE,
      result: CheckResult.SUCCESS,
    });

    expect(transaction.incident.update).toHaveBeenCalledWith({
      where: { id: "incident-1" },
      data: { recoveredAt: baseInput.checkedAt },
    });
    expect(transaction.incidentEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        kind: "CHANNEL_RECOVERED",
        previousStatus: IncidentStatus.IN_PROGRESS,
        newStatus: IncidentStatus.IN_PROGRESS,
      }),
    }));
    expect(transaction.incident.create).not.toHaveBeenCalled();
  });
});
