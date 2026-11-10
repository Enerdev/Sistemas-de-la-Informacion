import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { errorHandler } from "../http/error-handler.js";
import { createRateLimit } from "../http/rate-limit.js";
import { createFailureReportSchema, generateReferenceCode } from "./routes.js";

const now = new Date("2026-11-10T15:00:00.000Z");
const schema = createFailureReportSchema(() => now);
const valid = {
  channelId: "00000000-0000-4000-8000-000000000001",
  description: "La aplicación muestra un error al iniciar sesión.",
};

describe("public failure reports", () => {
  it("accepts optional fields left empty and normalizes the contact email", () => {
    expect(schema.parse({ ...valid, contactEmail: "", occurredAt: "" })).toEqual({
      ...valid,
      contactEmail: undefined,
      occurredAt: undefined,
    });
    expect(schema.parse({ ...valid, contactEmail: " Persona@Correo.PE " }).contactEmail).toBe("persona@correo.pe");
  });

  it("rejects invalid email, short descriptions, impossible dates and filled honeypots", () => {
    expect(schema.safeParse({ ...valid, contactEmail: "no-es-correo" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, description: "falla" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, occurredAt: "2026-11-11T15:00:00.000Z" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, occurredAt: "2026-09-01T15:00:00.000Z" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, occurredAt: "2026-11-10T14:00:00.000Z" }).success).toBe(true);
    expect(schema.safeParse({ ...valid, website: "https://spam.example" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, role: "ADMIN" }).success).toBe(false);
  });

  it("generates unambiguous tracking codes", () => {
    const codes = new Set(Array.from({ length: 50 }, generateReferenceCode));
    expect(codes.size).toBe(50);
    for (const code of codes) expect(code).toMatch(/^R-[A-HJ-NP-Z2-9]{8}$/);
  });

  it("validates a report before touching the database", async () => {
    const response = await request(app).post("/api/public/reports").send({ channelId: "x", description: "" });
    expect(response.status).toBe(400);
    expect(response.body.error.details.map((detail: { field: string }) => detail.field))
      .toEqual(expect.arrayContaining(["channelId", "description"]));
  });

  it("keeps internal report management behind authentication", async () => {
    expect((await request(app).get("/api/reports")).status).toBe(401);
    expect((await request(app).patch("/api/reports/00000000-0000-4000-8000-000000000000").send({ status: "REVIEWED" })).status)
      .toBe(401);
  });
});

describe("createRateLimit", () => {
  it("answers 429 with Retry-After after the limit and resets after the window", async () => {
    let clock = 0;
    const limited = express();
    limited.post("/", createRateLimit({ windowMillis: 60_000, max: 2, message: "Espera", now: () => clock }), (_request, response) => {
      response.status(204).end();
    });
    limited.use(errorHandler);

    expect((await request(limited).post("/")).status).toBe(204);
    expect((await request(limited).post("/")).status).toBe(204);
    const blocked = await request(limited).post("/");
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBe("60");
    clock = 60_000;
    expect((await request(limited).post("/")).status).toBe(204);
  });
});
