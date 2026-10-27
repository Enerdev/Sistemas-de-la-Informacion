import { CheckResult, CheckSource } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { HttpEndpointVerifier, SimulatedServiceVerifier } from "./verifiers.js";

describe("SimulatedServiceVerifier", () => {
  const verifier = new SimulatedServiceVerifier();

  it("returns a deterministic successful result for an operational simulated service", async () => {
    const first = await verifier.verify("sim://app-bn", 5000);
    const second = await verifier.verify("sim://app-bn", 5000);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      source: CheckSource.SIMULATED,
      result: CheckResult.SUCCESS,
      responseTimeMs: 25,
      httpStatusCode: null,
      detail: null,
    });
  });

  it("distinguishes simulated failures from HTTP network failures", async () => {
    const result = await verifier.verify("sim://down", 5000);

    expect(result.source).toBe(CheckSource.SIMULATED);
    expect(result.result).toBe(CheckResult.FAILURE);
    expect(result.detail).toContain("Fallo simulado");
  });

  it("provides a deterministic slow response for degradation checks", async () => {
    const result = await verifier.verify("sim://slow-1500", 5000);

    expect(result.source).toBe(CheckSource.SIMULATED);
    expect(result.result).toBe(CheckResult.SUCCESS);
    expect(result.responseTimeMs).toBe(1500);
  });

  it("does not send requests to endpoints outside the explicit HTTPS allowlist", async () => {
    const verifier = new HttpEndpointVerifier(["health.example.edu"]);
    const result = await verifier.verify("https://not-authorized.example/health", 1000);

    expect(result.source).toBe(CheckSource.HTTP);
    expect(result.result).toBe(CheckResult.FAILURE);
    expect(result.detail).toContain("Endpoint no autorizado");
  });
});
