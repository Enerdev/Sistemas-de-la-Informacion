import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createChannelSchema,
  monitoringToggleSchema,
  updateChannelSchema,
} from "./schemas.js";

describe("channel request schemas", () => {
  const validChannel = {
    code: "SIM_TEST",
    name: "Servicio de prueba",
    type: "APP",
    simulatedTarget: "sim://prueba",
  };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts simulated services and defaults monitoring configuration", () => {
    const result = createChannelSchema.parse(validChannel);
    expect(result.monitoringConfig?.checkIntervalSeconds).toBe(60);
  });

  it("rejects external service URLs and unknown fields", () => {
    expect(
      createChannelSchema.safeParse({
        ...validChannel,
        simulatedTarget: "https://example.invalid/health",
      }).success,
    ).toBe(false);
    expect(
      createChannelSchema.safeParse({ ...validChannel, password: "should-not-be-here" }).success,
    ).toBe(false);
  });

  it("accepts only explicitly allowlisted HTTPS authorities", () => {
    vi.stubEnv("MONITORING_DRIVER", "http");
    vi.stubEnv("MONITORING_HTTP_ALLOWED_HOSTS", "health.example.edu:8443");

    expect(
      createChannelSchema.safeParse({
        ...validChannel,
        simulatedTarget: "https://health.example.edu:8443/health",
      }).success,
    ).toBe(true);
    expect(
      createChannelSchema.safeParse({
        ...validChannel,
        simulatedTarget: "https://health.example.edu/health",
      }).success,
    ).toBe(false);
    expect(
      createChannelSchema.safeParse({
        ...validChannel,
        simulatedTarget: "https://user:password@health.example.edu:8443/health",
      }).success,
    ).toBe(false);
  });

  it("requires at least one update field and a boolean monitoring value", () => {
    expect(updateChannelSchema.safeParse({}).success).toBe(false);
    expect(monitoringToggleSchema.safeParse({ monitoringEnabled: "true" }).success).toBe(false);
    expect(monitoringToggleSchema.safeParse({ monitoringEnabled: true }).success).toBe(true);
  });
});
