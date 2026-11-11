import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { indicatorQuerySchema } from "./routes.js";
import { scheduleImportSchema } from "../payment-schedule/routes.js";

describe("indicator and schedule routes", () => {
  it("validates the period, target and uploaded file name", () => {
    const from = "2026-11-01T00:00:00.000Z";
    expect(indicatorQuerySchema.parse({ from, to: "2026-11-10T00:00:00.000Z" }).target).toBe(99);
    expect(indicatorQuerySchema.safeParse({ from, to: "2026-10-01T00:00:00.000Z" }).success).toBe(false);
    expect(indicatorQuerySchema.safeParse({ from: "2024-01-01T00:00:00.000Z", to: "2026-01-01T00:00:00.000Z" }).success).toBe(false);
    expect(indicatorQuerySchema.safeParse({ from, to: "2026-11-10T00:00:00.000Z", target: "120" }).success).toBe(false);
    expect(scheduleImportSchema.safeParse({ fileName: "cronograma.xlsx", content: "x" }).success).toBe(false);
  });

  it("requires authentication", async () => {
    expect((await request(app).get("/api/indicators")).status).toBe(401);
    expect((await request(app).get("/api/payment-schedule")).status).toBe(401);
    expect((await request(app).post("/api/payment-schedule/import").send({})).status).toBe(401);
  });
});
