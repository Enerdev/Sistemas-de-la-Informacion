import { describe, expect, it } from "vitest";
import { loadConfig } from "./env.js";

describe("loadConfig", () => {
  it("valida la configuración requerida y aplica valores predeterminados", () => {
    const config = loadConfig({
      DATABASE_URL: "postgresql://simona:local-only@localhost:5432/simona_bn",
    });

    expect(config.NODE_ENV).toBe("development");
    expect(config.PORT).toBe(3001);
    expect(config.DATABASE_URL).toContain("localhost");
  });

  it("rechaza una URL de base de datos que no use PostgreSQL", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: "https://example.invalid/database",
      }),
    ).toThrow(/DATABASE_URL debe usar el protocolo postgresql:\/\/ o postgres:\/\//);
  });

  it("requiere una lista de hosts cuando se activa el verificador HTTP", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: "postgresql://simona:local-only@localhost:5432/simona_bn",
        MONITORING_DRIVER: "http",
      }),
    ).toThrow(/MONITORING_HTTP_ALLOWED_HOSTS es obligatorio/);

    expect(
      loadConfig({
        DATABASE_URL: "postgresql://simona:local-only@localhost:5432/simona_bn",
        MONITORING_DRIVER: "http",
        MONITORING_HTTP_ALLOWED_HOSTS: "health.example.edu,health.example.edu",
      }).MONITORING_HTTP_ALLOWED_HOSTS,
    ).toEqual(["health.example.edu"]);

    expect(() =>
      loadConfig({
        DATABASE_URL: "postgresql://simona:local-only@localhost:5432/simona_bn",
        MONITORING_DRIVER: "http",
        MONITORING_HTTP_ALLOWED_HOSTS: "https://health.example.edu/health",
      }),
    ).toThrow(/solo acepta host o autoridad host:puerto/);
  });
});
