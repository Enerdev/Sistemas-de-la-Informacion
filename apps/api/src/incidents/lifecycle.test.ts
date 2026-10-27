import { IncidentStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { assertIncidentTransition } from "./lifecycle.js";

describe("incident lifecycle transitions", () => {
  it.each([
    [IncidentStatus.OPEN, IncidentStatus.IN_PROGRESS, "OPERATOR"],
    [IncidentStatus.IN_PROGRESS, IncidentStatus.RESOLVED, "OPERATOR"],
    [IncidentStatus.RESOLVED, IncidentStatus.CLOSED, "ADMIN"],
  ] as const)("allows %s → %s for %s", (currentStatus, nextStatus, role) => {
    expect(() => assertIncidentTransition({ currentStatus, nextStatus, role })).not.toThrow();
  });

  it.each([
    [IncidentStatus.OPEN, IncidentStatus.RESOLVED, "ADMIN", 409],
    [IncidentStatus.IN_PROGRESS, IncidentStatus.CLOSED, "ADMIN", 409],
    [IncidentStatus.RESOLVED, IncidentStatus.IN_PROGRESS, "ADMIN", 409],
    [IncidentStatus.CLOSED, IncidentStatus.IN_PROGRESS, "ADMIN", 409],
    [IncidentStatus.RESOLVED, IncidentStatus.CLOSED, "OPERATOR", 403],
    [IncidentStatus.OPEN, IncidentStatus.IN_PROGRESS, "VIEWER", 403],
  ] as const)("rejects %s → %s for %s", (currentStatus, nextStatus, role, statusCode) => {
    try {
      assertIncidentTransition({ currentStatus, nextStatus, role });
    } catch (error) {
      expect(error).toMatchObject({ statusCode });
      return;
    }
    throw new Error("Expected transition to be rejected");
  });
});
